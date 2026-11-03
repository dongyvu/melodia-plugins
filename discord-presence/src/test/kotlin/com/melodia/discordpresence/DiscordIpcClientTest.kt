package com.melodia.discordpresence

import com.lin0721.linmusic.plugin.api.PluginLogger
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private const val READY = """{"cmd":"DISPATCH","evt":"READY"}"""

private object SilentLogger : PluginLogger {
    override fun info(message: String) = Unit
    override fun warn(message: String, error: Throwable?) = Unit
    override fun error(message: String, error: Throwable?) = Unit
}

private class FakePipe : IpcTransport {
    private var incoming = ByteArray(0)
    private val written = ArrayList<Pair<Int, String>>()
    var broken = false
    var closed = false

    val frames: List<Pair<Int, String>> get() = written

    fun feed(data: ByteArray) {
        incoming += data
    }

    override fun available(): Long = incoming.size.toLong()

    override fun read(target: ByteArray) {
        incoming.copyInto(target, 0, 0, target.size)
        incoming = incoming.copyOfRange(target.size, incoming.size)
    }

    override fun write(data: ByteArray) {
        if (broken) throw IOException("管道正在被关闭")
        val fields = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
        val op = fields.getInt()
        val body = ByteArray(fields.getInt()).also(fields::get)
        written += op to ByteArrayOutputStream().apply { write(body) }.toString(Charsets.UTF_8)
    }

    override fun close() {
        closed = true
    }
}

class DiscordIpcClientTest {
    private val pipes = ArrayList<FakePipe>()
    private var online = true
    private val client = DiscordIpcClient("123", 42, SilentLogger) {
        if (online) FakePipe().also(pipes::add) else null
    }

    private fun connectedAt(now: Long): FakePipe {
        client.step(now)
        val pipe = pipes.last()
        pipe.feed(encodeFrame(1, READY))
        client.step(now)
        return pipe
    }

    @Test
    fun staysDisconnectedWhileNothingToShow() {
        client.step(0)
        assertTrue(pipes.isEmpty())
    }

    @Test
    fun handshakeThenSendsActivity() {
        client.update("""{"details":"歌"}""")
        val pipe = connectedAt(10_000)

        assertEquals(0, pipe.frames[0].first)
        assertEquals("""{"v":1,"client_id":"123"}""", pipe.frames[0].second)
        assertEquals(1, pipe.frames[1].first)
        assertContains(pipe.frames[1].second, """"pid":42,"activity":{"details":"歌"}""")
    }

    @Test
    fun clearsActivityWithNull() {
        client.update("{}")
        val pipe = connectedAt(10_000)
        client.update(null)
        client.step(11_000)

        assertContains(pipe.frames.last().second, """"activity":null""")
    }

    @Test
    fun mergesRapidUpdatesAndSendsLatest() {
        client.update("""{"n":1}""")
        val pipe = connectedAt(10_000)
        client.update("""{"n":2}""")
        client.step(10_200)
        client.update("""{"n":3}""")
        client.step(10_400)
        assertEquals(2, pipe.frames.size)

        client.step(11_000)
        assertEquals(3, pipe.frames.size)
        assertContains(pipe.frames.last().second, """{"n":3}""")
    }

    @Test
    fun pingsWhileIdleAndAnswersPing() {
        client.update("{}")
        val pipe = connectedAt(10_000)
        client.step(20_000)
        assertEquals(3, pipe.frames.last().first)

        pipe.feed(encodeFrame(3, """{"x":1}"""))
        client.step(20_200)
        assertEquals(4 to """{"x":1}""", pipe.frames.last())
    }

    @Test
    fun brokenPipeFoundByPingReconnectsAndResends() {
        client.update("""{"n":1}""")
        val first = connectedAt(10_000)
        first.broken = true
        client.step(20_000)
        assertTrue(first.closed)

        client.step(24_000)
        assertEquals(1, pipes.size)

        val second = connectedAt(25_000)
        assertEquals(2, pipes.size)
        assertContains(second.frames.last().second, """{"n":1}""")
    }

    @Test
    fun retriesWithBackoffWhileDiscordIsAway() {
        online = false
        client.update("{}")
        client.step(0)
        online = true

        client.step(4_999)
        assertTrue(pipes.isEmpty())
        client.step(5_000)
        assertEquals(1, pipes.size)
    }

    @Test
    fun closeFrameDropsConnection() {
        client.update("{}")
        val pipe = connectedAt(10_000)
        pipe.feed(encodeFrame(2, """{"code":4000}"""))
        client.step(10_200)
        assertTrue(pipe.closed)
    }

    @Test
    fun handshakeTimeoutDropsConnection() {
        client.update("{}")
        client.step(0)
        client.step(5_000)
        assertTrue(pipes.single().closed)
    }

    @Test
    fun clearsActivityBeforeClosing() {
        client.update("{}")
        val pipe = connectedAt(10_000)
        client.clearAndDisconnect()

        assertContains(pipe.frames.last().second, """"activity":null""")
        assertTrue(pipe.closed)
    }

    @Test
    fun invalidFrameLengthDropsConnection() {
        client.update("{}")
        val pipe = connectedAt(10_000)
        pipe.feed(ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putInt(1).putInt(-1).array())
        client.step(10_200)
        assertTrue(pipe.closed)
    }

    @Test
    fun waitsForPartialFrame() {
        client.update("{}")
        client.step(0)
        val pipe = pipes.single()
        val frame = encodeFrame(1, READY)
        pipe.feed(frame.copyOf(10))
        client.step(100)
        assertEquals(1, pipe.frames.size)

        pipe.feed(frame.copyOfRange(10, frame.size))
        client.step(1_100)
        assertEquals(2, pipe.frames.size)
    }
}
