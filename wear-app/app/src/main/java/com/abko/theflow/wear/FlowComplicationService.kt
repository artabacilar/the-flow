package com.abko.theflow.wear

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService

/**
 * The Flow on a watch face: Big Rocks left today, the next one, and how far
 * through today you are. Tapping it opens the app, which is where ticking
 * happens — a complication is read, not pressed.
 */
class FlowComplicationService : SuspendingComplicationDataSourceService() {

    companion object {
        fun refresh(ctx: Context) {
            runCatching {
                ComplicationDataSourceUpdateRequester.create(ctx, ComponentName(ctx, FlowComplicationService::class.java)).requestUpdateAll()
            }
        }
    }

    private fun text(s: String) = PlainComplicationText.Builder(s).build()

    private fun tap(): PendingIntent = PendingIntent.getActivity(
        this, 0, Intent(this, MainActivity::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        build(type, FlowApi.Day("Tuesday", "2 Big Rocks for today.", FlowApi.Next("p", "Send the venue contract", "Today 10:00"),
            2, 1, 0, emptyList(), emptyList(), 3, 8, ""), true)

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        val linked = Store.linked(this)
        val day = if (linked) runCatching { FlowApi.today(this) }.getOrNull() ?: Store.lastDay(this) else null
        return build(request.complicationType, day, linked)
    }

    private fun build(type: ComplicationType, day: FlowApi.Day?, linked: Boolean): ComplicationData? {
        val left = day?.let { it.open + it.overdue } ?: 0
        val short = if (!linked) "Link" else if (day == null) "–" else if (left == 0) "✓" else left.toString()
        val next = day?.next?.title ?: ""
        val desc = text(if (!linked) "Open The Flow to link this watch" else day?.headline ?: "The Flow")
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(text(short), desc)
                .setTitle(text(if (left == 0) "done" else "left")).setTapAction(tap()).build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(
                text(if (!linked) "The Flow — link this watch" else if (next.isNotEmpty()) next else (day?.headline ?: "The Flow")), desc)
                .setTitle(text(if (linked && day != null) day.headline else "The Flow")).setTapAction(tap()).build()
            ComplicationType.RANGED_VALUE -> {
                val total = ((day?.open ?: 0) + (day?.doneToday ?: 0)).coerceAtLeast(1)
                RangedValueComplicationData.Builder((day?.doneToday ?: 0).toFloat(), 0f, total.toFloat(), desc)
                    .setText(text(short)).setTapAction(tap()).build()
            }
            else -> null
        }
    }
}
