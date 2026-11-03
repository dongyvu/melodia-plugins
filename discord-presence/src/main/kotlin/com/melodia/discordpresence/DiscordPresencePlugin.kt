package com.melodia.discordpresence

import com.lin0721.linmusic.plugin.api.MelodiaPlugin
import com.lin0721.linmusic.plugin.api.NowPlayingSong
import com.lin0721.linmusic.plugin.api.PlaybackListener
import com.lin0721.linmusic.plugin.api.PluginContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

private const val APPLICATION_ID = "1566840871863976047"
private const val SETTING_PAUSED_BEHAVIOR = "paused_behavior"
private const val ACTION_SETTINGS_CHANGED = "settingsChanged"

class DiscordPresencePlugin : MelodiaPlugin {
    private val refresh = Channel<Unit>(Channel.CONFLATED)
    private val publisher = PresencePublisher()

    @Volatile
    private var anchor: ProgressAnchor? = null

    @Volatile
    private var client: DiscordIpcClient? = null

    private val listener = object : PlaybackListener {
        override fun onSongChanged(song: NowPlayingSong?) {
            refresh.trySend(Unit)
        }

        override fun onPlayStateChanged(playing: Boolean) {
            refresh.trySend(Unit)
        }

        override fun onProgress(positionMs: Long, durationMs: Long) {
            if (anchor?.matches(positionMs, durationMs, System.currentTimeMillis()) != true) refresh.trySend(Unit)
        }
    }

    override fun onLoad(context: PluginContext) {
        val ipc = DiscordIpcClient(APPLICATION_ID, ProcessHandle.current().pid(), context.logger)
        client = ipc
        ipc.start()
        context.extensions.playbackListener(listener)
        context.extensions.action(ACTION_SETTINGS_CHANGED) { refresh.trySend(Unit) }
        context.scope.launch { publishLoop(context, ipc) }
    }

    override fun onUnload() {
        client?.close()
        client = null
    }

    // 插件启动时宿主不补发事件，这里先同步一次
    private suspend fun publishLoop(context: PluginContext, ipc: DiscordIpcClient) {
        while (currentCoroutineContext().isActive) {
            val wakeAfterMs = try {
                sync(context, ipc)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                context.logger.warn("读取播放状态失败", e)
                null
            }
            if (wakeAfterMs == null) refresh.receive() else withTimeoutOrNull(wakeAfterMs) { refresh.receive() }
        }
    }

    private suspend fun sync(context: PluginContext, ipc: DiscordIpcClient): Long? {
        val song = context.player.current()
        val state = context.player.state()
        val behavior = PausedBehavior.fromKey(context.settings.get(SETTING_PAUSED_BEHAVIOR) as? String)
        val now = System.currentTimeMillis()
        val track = song?.let { TrackSnapshot(it.title, it.artist, it.cover, state.playing, state.positionMs, state.durationMs) }
        anchor = track?.let { ProgressAnchor(it.positionMs, it.durationMs, it.playing, now) }
        val result = publisher.resolve(track, behavior, now)
        ipc.update(result.activity)
        return result.wakeAfterMs
    }
}
