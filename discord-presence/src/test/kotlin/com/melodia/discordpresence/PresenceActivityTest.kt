package com.melodia.discordpresence

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val PLAYING = TrackSnapshot("晴天", "周杰伦", "https://p1.music.126.net/a.jpg", true, 30_000, 200_000)
private val PAUSED = PLAYING.copy(playing = false)

class PresenceActivityTest {
    @Test
    fun playingActivityCarriesTimeBar() {
        val json = activityJson(PLAYING, 1_000_000)
        assertContains(json, """"type":2""")
        assertContains(json, """"details":"晴天"""")
        assertContains(json, """"state":"周杰伦"""")
        assertContains(json, """"timestamps":{"start":970000,"end":1170000}""")
        assertContains(json, """"large_image":"https://p1.music.126.net/a.jpg"""")
    }

    @Test
    fun unknownDurationOnlySendsStart() {
        assertContains(activityJson(PLAYING.copy(durationMs = 0), 1_000_000), """"timestamps":{"start":970000}""")
    }

    @Test
    fun pausedActivityHasNoTimeBar() {
        val json = activityJson(PAUSED, 1_000_000)
        assertFalse("timestamps" in json)
        assertContains(json, """"state":"周杰伦 · 已暂停"""")
    }

    @Test
    fun missingArtistOmitsStateUnlessPaused() {
        assertFalse("\"state\"" in activityJson(PLAYING.copy(artist = " "), 0))
        assertContains(activityJson(PAUSED.copy(artist = ""), 0), """"state":"已暂停"""")
    }

    @Test
    fun blankTitleFallsBack() {
        assertContains(activityJson(PLAYING.copy(title = ""), 0), """"details":"未知歌曲"""")
    }

    @Test
    fun localOrOverlongCoverUsesLogo() {
        assertContains(activityJson(PLAYING.copy(cover = "file:///C:/a.jpg"), 0), """"large_image":"logo"""")
        assertContains(activityJson(PLAYING.copy(cover = ""), 0), """"large_image":"logo"""")
        assertContains(activityJson(PLAYING.copy(cover = "https://a/" + "b".repeat(300)), 0), """"large_image":"logo"""")
    }

    @Test
    fun fitTextEnforcesDiscordLimits() {
        assertNull(fitText("  "))
        assertEquals(2, fitText("A")?.length)
        assertEquals(128, fitText("长".repeat(200))?.length)
    }

    @Test
    fun fitTextNeverSplitsSurrogatePair() {
        val text = assertNotNull(fitText("长".repeat(127) + "😀"))
        assertEquals(127, text.length)
    }

    @Test
    fun jsonEscapesQuotesAndControlCharacters() {
        assertEquals(""""a\"b\\c\u000a"""", jsonString("a\"b\\c\n"))
    }

    @Test
    fun unknownBehaviorDefaultsToClear() {
        assertEquals(PausedBehavior.CLEAR, PausedBehavior.fromKey(null))
        assertEquals(PausedBehavior.KEEP, PausedBehavior.fromKey("keep"))
    }

    @Test
    fun clearBehaviorRemovesActivityOncePauseSettles() {
        val publisher = PresencePublisher()
        publisher.resolve(PAUSED, PausedBehavior.CLEAR, 0)
        val result = publisher.resolve(PAUSED, PausedBehavior.CLEAR, PAUSE_SETTLE_MS)
        assertNull(result.activity)
        assertNull(result.wakeAfterMs)
    }

    @Test
    fun briefStallKeepsCurrentActivity() {
        val publisher = PresencePublisher()
        val playing = publisher.resolve(PLAYING, PausedBehavior.CLEAR, 0).activity
        val stalled = publisher.resolve(PAUSED, PausedBehavior.CLEAR, 1_000)
        assertEquals(playing, stalled.activity)
        assertEquals(PAUSE_SETTLE_MS, stalled.wakeAfterMs)
        assertEquals(500, publisher.resolve(PAUSED, PausedBehavior.CLEAR, 2_000).wakeAfterMs)
        assertNotNull(publisher.resolve(PLAYING, PausedBehavior.CLEAR, 2_200).activity)
        assertEquals(PAUSE_SETTLE_MS, publisher.resolve(PAUSED, PausedBehavior.CLEAR, 3_000).wakeAfterMs)
    }

    @Test
    fun keepBehaviorClearsAfterTimeout() {
        val publisher = PresencePublisher()
        publisher.resolve(PAUSED, PausedBehavior.KEEP, 0)
        val kept = publisher.resolve(PAUSED, PausedBehavior.KEEP, PAUSE_SETTLE_MS)
        assertNotNull(kept.activity)
        assertEquals(PAUSED_KEEP_MS - PAUSE_SETTLE_MS, kept.wakeAfterMs)

        assertNull(publisher.resolve(PAUSED, PausedBehavior.KEEP, PAUSED_KEEP_MS).activity)
    }

    @Test
    fun resumingResetsPauseTimer() {
        val publisher = PresencePublisher()
        publisher.resolve(PAUSED, PausedBehavior.KEEP, 0)
        publisher.resolve(PAUSED, PausedBehavior.KEEP, PAUSED_KEEP_MS)
        assertNotNull(publisher.resolve(PLAYING, PausedBehavior.KEEP, PAUSED_KEEP_MS * 2).activity)
        val paused = publisher.resolve(PAUSED, PausedBehavior.KEEP, PAUSED_KEEP_MS * 2 + 100)
        assertEquals(PAUSE_SETTLE_MS, paused.wakeAfterMs)
    }

    @Test
    fun nothingPlayingClearsActivity() {
        assertNull(PresencePublisher().resolve(null, PausedBehavior.KEEP, 0).activity)
    }

    @Test
    fun anchorAcceptsNormalProgressAndDetectsSeek() {
        val anchor = ProgressAnchor(10_000, 200_000, true, 0)
        assertTrue(anchor.matches(15_000, 200_000, 5_000))
        assertFalse(anchor.matches(60_000, 200_000, 5_000))
        assertFalse(anchor.matches(15_000, 180_000, 5_000))
    }
}
