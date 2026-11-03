package com.melodia.discordpresence

import kotlin.math.abs

private const val ACTIVITY_TYPE_LISTENING = 2

// 成员列表显示 details，即「正在听 歌名」
private const val STATUS_DISPLAY_DETAILS = 2
private const val MIN_TEXT_LENGTH = 2
private const val MAX_TEXT_LENGTH = 128
private const val MAX_IMAGE_URL_LENGTH = 256
private const val FALLBACK_TITLE = "未知歌曲"
private const val FALLBACK_IMAGE = "logo"
private const val PAUSED_LABEL = "已暂停"
private const val TEXT_PADDING = '​'
private const val DRIFT_TOLERANCE_MS = 2_000L
internal const val PAUSED_KEEP_MS = 30 * 60 * 1000L
internal const val PAUSE_SETTLE_MS = 1_500L

internal data class TrackSnapshot(
    val title: String,
    val artist: String,
    val cover: String,
    val playing: Boolean,
    val positionMs: Long,
    val durationMs: Long
)

internal enum class PausedBehavior(val key: String) {
    CLEAR("clear"),
    KEEP("keep");

    companion object {
        fun fromKey(key: String?): PausedBehavior = entries.firstOrNull { it.key == key } ?: CLEAR
    }
}

internal class PresenceResult(val activity: String?, val wakeAfterMs: Long?)

// 只在 sync 所在的协程里调用
internal class PresencePublisher {
    private var pausedAt: Long? = null
    private var published: String? = null

    fun resolve(track: TrackSnapshot?, behavior: PausedBehavior, now: Long): PresenceResult {
        if (track == null || track.playing) {
            pausedAt = null
            published = track?.let { activityJson(it, now) }
            return PresenceResult(published, null)
        }
        val elapsed = now - (pausedAt ?: now.also { pausedAt = it })
        // 缓冲和切歌间隙 isPlaying 也是 false，确认真的暂停了才改状态
        if (elapsed < PAUSE_SETTLE_MS) return PresenceResult(published, PAUSE_SETTLE_MS - elapsed)
        val remaining = PAUSED_KEEP_MS - elapsed
        published = if (behavior == PausedBehavior.KEEP && remaining > 0) activityJson(track, now) else null
        return PresenceResult(published, remaining.takeIf { published != null })
    }
}

// 宿主没有跳转事件，靠进度与推算位置的偏差判断
internal class ProgressAnchor(
    private val positionMs: Long,
    private val durationMs: Long,
    private val playing: Boolean,
    private val at: Long
) {
    fun matches(reportedPositionMs: Long, reportedDurationMs: Long, now: Long): Boolean {
        if (reportedDurationMs != durationMs) return false
        val expected = if (playing) positionMs + (now - at) else positionMs
        return abs(reportedPositionMs - expected) <= DRIFT_TOLERANCE_MS
    }
}

internal fun activityJson(track: TrackSnapshot, now: Long): String = buildString {
    val title = fitText(track.title) ?: FALLBACK_TITLE
    val artist = fitText(track.artist)
    val state = if (track.playing) artist else fitText(listOfNotNull(artist, PAUSED_LABEL).joinToString(" · "))
    append("{\"type\":").append(ACTIVITY_TYPE_LISTENING)
    append(",\"status_display_type\":").append(STATUS_DISPLAY_DETAILS)
    append(",\"details\":").append(jsonString(title))
    state?.let { append(",\"state\":").append(jsonString(it)) }
    timestampsJson(track, now)?.let { append(",\"timestamps\":").append(it) }
    append(",\"assets\":{\"large_image\":").append(jsonString(imageOf(track.cover))).append("}}")
}

private fun timestampsJson(track: TrackSnapshot, now: Long): String? {
    if (!track.playing) return null
    val start = now - track.positionMs.coerceAtLeast(0)
    return if (track.durationMs > 0) "{\"start\":$start,\"end\":${start + track.durationMs}}" else "{\"start\":$start}"
}

// 本地音乐的封面不是公网地址，Discord 取不到
private fun imageOf(cover: String): String {
    val remote = cover.startsWith("https://") || cover.startsWith("http://")
    return if (remote && cover.length <= MAX_IMAGE_URL_LENGTH) cover else FALLBACK_IMAGE
}

// Discord 拒绝短于 2 个字符的文本，单字歌名用零宽字符补齐
internal fun fitText(value: String): String? {
    val trimmed = value.trim()
    if (trimmed.isEmpty()) return null
    if (trimmed.length < MIN_TEXT_LENGTH) return trimmed.padEnd(MIN_TEXT_LENGTH, TEXT_PADDING)
    if (trimmed.length <= MAX_TEXT_LENGTH) return trimmed
    val end = if (trimmed[MAX_TEXT_LENGTH - 1].isHighSurrogate()) MAX_TEXT_LENGTH - 1 else MAX_TEXT_LENGTH
    return trimmed.substring(0, end)
}

internal fun jsonString(value: String): String = buildString(value.length + 2) {
    append('"')
    for (char in value) {
        when {
            char == '"' -> append("\\\"")
            char == '\\' -> append("\\\\")
            char < ' ' -> append("\\u").append(char.code.toString(16).padStart(4, '0'))
            else -> append(char)
        }
    }
    append('"')
}
