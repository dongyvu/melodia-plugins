package com.melodia.discordpresence

import java.io.Closeable
import java.io.FileNotFoundException
import java.io.RandomAccessFile

private const val PIPE_COUNT = 10

internal interface IpcTransport : Closeable {
    // 对端退出后这里仍返回 0，断线只能靠写入发现
    fun available(): Long
    fun read(target: ByteArray)
    fun write(data: ByteArray)
}

internal fun interface IpcConnector {
    fun open(): IpcTransport?
}

// JDK 会把官方文档的 \\?\ 前缀规范化成相对路径，这里必须用 \\.\
internal object WindowsPipeConnector : IpcConnector {
    override fun open(): IpcTransport? {
        for (index in 0 until PIPE_COUNT) {
            try {
                return PipeTransport(RandomAccessFile("\\\\.\\pipe\\discord-ipc-$index", "rw"))
            } catch (e: FileNotFoundException) {
                continue
            }
        }
        return null
    }
}

// 同步句柄上的阻塞读会卡住写，所以先查可读字节，读写都放在同一线程
private class PipeTransport(private val file: RandomAccessFile) : IpcTransport {
    override fun available(): Long = file.length()
    override fun read(target: ByteArray) = file.readFully(target)
    override fun write(data: ByteArray) = file.write(data)
    override fun close() = file.close()
}
