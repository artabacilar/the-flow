package com.abko.theflow.wear

import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.TimeZone

/**
 * The Flow's server, as the watch sees it: one read of today, one call that
 * ticks or adds and answers with the new day, and the two calls that link the
 * watch with a code. The same endpoints the Apple Watch uses.
 */
object FlowApi {
    const val ORIGIN = "https://theflow.today"

    class Unlinked : Exception("This watch was unlinked. Link it again.")
    class Offline : Exception("No connection. Showing the last day it read.")
    class ServerSaid(msg: String) : Exception(msg)

    data class Rock(val id: String, val title: String, val time: String?, val done: Boolean, val overdue: Boolean, val day: String?)
    data class Habit(val id: String, val name: String, val done: Boolean)
    data class Next(val id: String, val title: String, val whenText: String)
    data class Day(
        val weekday: String, val headline: String, val next: Next?,
        val open: Int, val doneToday: Int, val overdue: Int,
        val rocks: List<Rock>, val habits: List<Habit>,
        val weekDone: Int, val weekTotal: Int, val raw: String
    )

    fun parseDay(s: String): Day {
        val o = JSONObject(s)
        val c = o.optJSONObject("counts") ?: JSONObject()
        val w = o.optJSONObject("week") ?: JSONObject()
        val n = o.optJSONObject("next")
        fun str(j: JSONObject, k: String): String? = if (j.isNull(k)) null else j.optString(k, "").ifEmpty { null }
        val rocks = (o.optJSONArray("rocks") ?: JSONArray()).let { a ->
            (0 until a.length()).map { i -> a.getJSONObject(i).let { r ->
                Rock(r.getString("id"), r.optString("title"), str(r, "time"), r.optBoolean("done"), r.optBoolean("overdue"), str(r, "day"))
            } }
        }
        val habits = (o.optJSONArray("habits") ?: JSONArray()).let { a ->
            (0 until a.length()).map { i -> a.getJSONObject(i).let { h -> Habit(h.getString("id"), h.optString("name"), h.optBoolean("done")) } }
        }
        return Day(
            weekday = o.optString("weekday"), headline = o.optString("headline"),
            next = n?.let { Next(it.optString("id"), it.optString("title"), it.optString("when")) },
            open = c.optInt("today"), doneToday = c.optInt("todayDone"), overdue = c.optInt("overdue"),
            rocks = rocks, habits = habits,
            weekDone = w.optInt("done"), weekTotal = w.optInt("total"), raw = s
        )
    }

    private suspend fun call(ctx: Context, path: String, method: String = "GET", body: JSONObject? = null, auth: Boolean = true): String =
        withContext(Dispatchers.IO) {
            val q = if (path == "/api/watch") "?tz=" + URLEncoder.encode(TimeZone.getDefault().id, "UTF-8") else ""
            val conn = (URL(ORIGIN + path + q).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 15000; readTimeout = 20000
                useCaches = false
                setRequestProperty("X-Flow-Device", "wearos")
                setRequestProperty("Accept", "application/json")
                if (auth) {
                    val t = Store.token(ctx) ?: throw Unlinked()
                    setRequestProperty("Authorization", "Bearer $t")
                }
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
            }
            try {
                if (body != null) conn.outputStream.use { it.write(body.toString().toByteArray()) }
                val code = conn.responseCode
                val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
                if (code == 401 && auth) { Store.forget(ctx); throw Unlinked() }
                if (code !in 200..299) {
                    val msg = runCatching { JSONObject(text).optString("error") }.getOrNull()
                    throw ServerSaid(if (msg.isNullOrEmpty()) "The server said no ($code)." else msg)
                }
                text
            } catch (e: Unlinked) { throw e
            } catch (e: ServerSaid) { throw e
            } catch (e: Exception) { throw Offline()
            } finally { conn.disconnect() }
        }

    suspend fun today(ctx: Context): Day {
        val s = call(ctx, "/api/watch")
        Store.saveDay(ctx, s)
        return parseDay(s)
    }

    /** One round trip: the change, and the day as it now is. */
    suspend fun act(ctx: Context, body: JSONObject): Day {
        body.put("tz", TimeZone.getDefault().id)
        val s = call(ctx, "/api/watch", "POST", body)
        Store.saveDay(ctx, s)
        FlowComplicationService.refresh(ctx)
        return parseDay(s)
    }

    data class PairStart(val id: String, val code: String, val poll: Long)
    suspend fun startPairing(ctx: Context): PairStart {
        val model = (Build.MODEL ?: "").take(40)
        val o = JSONObject(call(ctx, "/api/watch/pair", "POST", JSONObject().put("device", "wearos").put("model", model), auth = false))
        return PairStart(o.getString("id"), o.getString("code"), o.optLong("poll", 3))
    }

    /** "waiting", "linked" (the token is stored), or "expired". */
    suspend fun pollPairing(ctx: Context, id: String): String = withContext(Dispatchers.IO) {
        val conn = (URL("$ORIGIN/api/watch/pair?id=" + URLEncoder.encode(id, "UTF-8")).openConnection() as HttpURLConnection)
        try {
            val code = conn.responseCode
            if (code == 404) return@withContext "expired"
            val o = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val status = o.optString("status")
            if (status == "linked") Store.link(ctx, o.getString("token"), o.optString("who"))
            status
        } catch (e: Exception) { "waiting" } finally { conn.disconnect() }
    }
}

/** The token and the last day read, kept in the app's own private storage. */
object Store {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("flow", Context.MODE_PRIVATE)
    fun token(ctx: Context): String? = prefs(ctx).getString("token", null)?.ifEmpty { null }
    fun linked(ctx: Context) = token(ctx) != null
    fun who(ctx: Context): String = prefs(ctx).getString("who", "") ?: ""
    fun link(ctx: Context, token: String, who: String) { prefs(ctx).edit().putString("token", token).putString("who", who).apply() }
    fun forget(ctx: Context) { prefs(ctx).edit().clear().apply() }
    fun saveDay(ctx: Context, raw: String) { prefs(ctx).edit().putString("day", raw).apply() }
    fun lastDay(ctx: Context): FlowApi.Day? = prefs(ctx).getString("day", null)?.let { runCatching { FlowApi.parseDay(it) }.getOrNull() }
}
