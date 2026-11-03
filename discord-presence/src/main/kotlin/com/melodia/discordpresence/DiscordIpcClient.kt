package com.melodia.discordpresence

import com.lin0721.linmusic.plugin.api.PluginLogger
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.concurrent.thread

private const val OP_HANDSHAKE = 0
private const val OP_FRAME = 1
private const val OP_CLOSE = 2
private const val OP_PING = 3
private const val OP_PONG = 4
private const val HEADER_SIZE = 8
private const val MAX_FRAME_SIZE = 1 shl 20
private const val RPC_VERSION = 1
private const val POLL_INTERVAL_MS = 200L
private const val READY_TIMEOUT_MS = 5_000L
private const val MIN_SEND_INTERVAL_MS = 1_000L
private const val PING_INTERVAL_MS = 10_000L
private const val STOP_TIMEOUT_MS = 1_000L
private const val MAX_LOGGED_LENGTH = 300
private val RETRY_DELAYS_MS = longArrayOf(5_000, 15_000, 60_000)

internal fun encodeFrame(op: Int, json: String): ByteArray {
    val body = json.toByteArray(Charsets.UTF_8)
    return ByteBuffer.allocate(HEADER_SIZE + body.size).order(ByteOrder.LITTLE_ENDIAN)
        .putInt(op).putInt(body.size).put(body).array()
}

// 所有管道操作都在 worker 线程，update 只改目标状态；没有可显示的内容时不主动连接
internal class DiscordIpcClient(
    private val clientId: String,
    private val pid: Long,
    private val logger: PluginLogger,
    private val connector: IpcConnector = WindowsPipeConnector
) {
    @Volatile
    private var desired: String? = null

    @Volatile
    private var stopped = false

    private var worker: Thread? = null
    private var transport: IpcTransport? = null
    private var ready = false
    private var sent: String? = null
    private var lastSendAt = 0L
    private var lastPingAt = 0L
    private var readyDeadline = 0L
    private var nextConnectAt = 0L
    private var failures = 0
    private var nonce = 0L
    private var pendingOp: Int? = null
    private var pendingLength = 0

    fun update(activity: String?) {
        desired = activity
    }

    fun start() {
        worker = thread(isDaemon = true, name = "discord-presence") { loop() }
    }

    fun close() {
        stopped = true
        val running = worker ?: return
        running.interrupt()
        running.join(STOP_TIMEOUT_MS)
    }

    private fun loop() {
        try {
            while (!stopped) {
                step(System.currentTimeMillis())
                Thread.sleep(POLL_INTERVAL_MS)
            }
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        } finally {
            clearAndDisconnect()
        }
    }

    internal fun clearAndDisconnect() {
        val link = transport
        try {
            if (link != null && ready && sent != null) link.write(encodeFrame(OP_FRAME, setActivityJson(null)))
        } catch (e: IOException) {
            logger.info("清除 Discord 状态失败：${e.message}")
        }
        disconnect()
    }

    internal fun step(now: Long) {
        val link = transport
        if (link == null) {
            if (desired != null && now >= nextConnectAt) connect(now)
            return
        }
        try {
            drain(link)
            if (ready) flush(link, now) else if (now >= readyDeadline) throw IOException("等待 Discord 就绪超时")
        } catch (e: IOException) {
            logger.info("与 Discord 的连接已断开：${e.message}")
            scheduleRetry(now)
        }
    }

    private fun connect(now: Long) {
        try {
            val link = connector.open()
            if (link == null) {
                scheduleRetry(now)
                return
            }
            transport = link
            link.write(encodeFrame(OP_HANDSHAKE, "{\"v\":$RPC_VERSION,\"client_id\":${jsonString(clientId)}}"))
            readyDeadline = now + READY_TIMEOUT_MS
        } catch (e: IOException) {
            scheduleRetry(now)
        }
    }

    private fun flush(link: IpcTransport, now: Long) {
        val target = desired
        if (target != sent) {
            if (now - lastSendAt >= MIN_SEND_INTERVAL_MS) {
                link.write(encodeFrame(OP_FRAME, setActivityJson(target)))
                sent = target
                lastSendAt = now
                lastPingAt = now
            }
        } else if (now - lastPingAt >= PING_INTERVAL_MS) {
            link.write(encodeFrame(OP_PING, "{}"))
            lastPingAt = now
        }
    }

    private fun setActivityJson(activity: String?): String =
        "{\"cmd\":\"SET_ACTIVITY\",\"nonce\":\"${++nonce}\",\"args\":{\"pid\":$pid,\"activity\":${activity ?: "null"}}}"

    // 帧没到齐时留到下一轮，避免在管道上阻塞读
    private fun drain(link: IpcTransport) {
        while (true) {
            val op = pendingOp
            if (op == null) {
                if (link.available() < HEADER_SIZE) return
                val header = ByteArray(HEADER_SIZE).also(link::read)
                val fields = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
                pendingOp = fields.getInt()
                pendingLength = fields.getInt()
                if (pendingLength !in 0..MAX_FRAME_SIZE) throw IOException("帧长度无效：$pendingLength")
            } else {
                if (link.available() < pendingLength) return
                val body = ByteArray(pendingLength).also(link::read)
                pendingOp = null
                handle(link, op, body)
            }
        }
    }

    private fun handle(link: IpcTransport, op: Int, body: ByteArray) {
        val text = body.toString(Charsets.UTF_8)
        when (op) {
            OP_FRAME -> when {
                "\"evt\":\"READY\"" in text -> {
                    ready = true
                    failures = 0
                    logger.info("已连接 Discord")
                }
                "\"evt\":\"ERROR\"" in text -> logger.warn("Discord 拒绝了状态：${text.take(MAX_LOGGED_LENGTH)}")
            }
            OP_PING -> link.write(encodeFrame(OP_PONG, text))
            OP_CLOSE -> throw IOException(text.take(MAX_LOGGED_LENGTH))
        }
    }

    private fun scheduleRetry(now: Long) {
        disconnect()
        nextConnectAt = now + RETRY_DELAYS_MS[failures.coerceAtMost(RETRY_DELAYS_MS.lastIndex)]
        failures++
    }

    private fun disconnect() {
        try {
            transport?.close()
        } catch (e: IOException) {
            logger.warn("关闭 Discord 管道失败", e)
        }
        transport = null
        ready = false
        sent = null
        pendingOp = null
    }
}
