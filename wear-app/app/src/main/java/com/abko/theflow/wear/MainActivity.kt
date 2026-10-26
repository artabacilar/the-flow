package com.abko.theflow.wear

import android.app.RemoteInput
import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Checkbox
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.ToggleChip
import androidx.wear.compose.material.ToggleChipDefaults
import androidx.wear.input.RemoteInputIntentHelper
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

private val Lime = Color(0xFFC8F26B)
private val Coral = Color(0xFFFF6B3D)

/**
 * The Flow on Wear OS — the same as on Apple Watch: today's Big Rocks and the
 * ones that slipped, what is next, today's habits to tick, and a Big Rock or a
 * note said into the watch. Linked with a six-character code typed into The
 * Flow on the phone or a computer.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { FlowWearApp() } }
    }
}

@Composable
fun FlowWearApp() {
    val ctx = LocalContext.current
    var linked by remember { mutableStateOf(Store.linked(ctx)) }
    if (linked) TodayScreen(onUnlinked = { linked = false }) else PairScreen(onLinked = { linked = true })
}

@Composable
fun PairScreen(onLinked: () -> Unit) {
    val ctx = LocalContext.current
    val haptic = LocalHapticFeedback.current
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableStateOf(0) }

    LaunchedEffect(attempt) {
        error = null; code = ""
        try {
            while (true) {
                val p = FlowApi.startPairing(ctx)
                code = p.code
                var status = "waiting"
                while (status == "waiting") {
                    delay(p.poll.coerceAtLeast(2) * 1000)
                    status = FlowApi.pollPairing(ctx, p.id)
                }
                if (status == "linked") {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    runCatching { FlowApi.today(ctx) }
                    onLinked(); return@LaunchedEffect
                }
                /* expired: ask for a fresh code and keep showing it */
            }
        } catch (e: Exception) {
            error = "Could not reach The Flow. Check the watch is online."
        }
    }

    val state = rememberScalingLazyListState()
    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(scalingLazyListState = state) }) {
        ScalingLazyColumn(state = state, modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            item { ListHeader { Text("Link this watch") } }
            if (code.isNotEmpty()) {
                item {
                    Text(code, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = Lime,
                        modifier = Modifier.semantics { contentDescription = code.toList().joinToString(" ") })
                }
                item {
                    Text("On your phone or computer, open The Flow → Settings → Watch and type this code.",
                        textAlign = TextAlign.Center, fontSize = 13.sp, color = MaterialTheme.colors.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 8.dp))
                }
                item { Text("theflow.today/watch", fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
                item { CircularProgressIndicator(modifier = Modifier.padding(top = 6.dp)) }
            } else if (error != null) {
                item { Text(error!!, textAlign = TextAlign.Center, fontSize = 13.sp) }
                item { Chip(onClick = { attempt++ }, label = { Text("Try again") }, colors = ChipDefaults.primaryChipColors()) }
            } else {
                item { CircularProgressIndicator() }
            }
        }
    }
}

private const val VOICE_KEY = "flow_text"

@Composable
fun TodayScreen(onUnlinked: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    var day by remember { mutableStateOf(Store.lastDay(ctx)) }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(setOf<String>()) }
    var adding by remember { mutableStateOf<String?>(null) }   // "rock" | "note"
    var confirmUnlink by remember { mutableStateOf(false) }

    suspend fun load() {
        try { day = FlowApi.today(ctx); note = null }
        catch (e: FlowApi.Unlinked) { onUnlinked() }
        catch (e: Exception) { note = e.message }
    }
    suspend fun act(body: JSONObject, key: String, undo: () -> Unit) {
        busy = busy + key
        try { day = FlowApi.act(ctx, body); note = null }
        catch (e: FlowApi.Unlinked) { onUnlinked() }
        catch (e: Exception) { undo(); note = e.message }
        busy = busy - key
    }

    /* Read again whenever the watch shows the app. */
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner) { owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { load() } }

    val voice = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val kind = adding; adding = null
        val said = res.data?.let { RemoteInput.getResultsFromIntent(it)?.getCharSequence(VOICE_KEY)?.toString() }?.trim()
        if (kind != null && !said.isNullOrEmpty()) scope.launch {
            act(JSONObject().put("action", "add").put("kind", kind).put("text", said), "add") {}
            if (note == null) haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        }
    }
    fun listen(kind: String, prompt: String) {
        adding = kind
        val input = RemoteInput.Builder(VOICE_KEY).setLabel(prompt).build()
        val intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
        RemoteInputIntentHelper.putRemoteInputsExtra(intent, listOf(input))
        voice.launch(intent)
    }

    val state = rememberScalingLazyListState()
    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(scalingLazyListState = state) }) {
        ScalingLazyColumn(state = state, modifier = Modifier.fillMaxSize()) {
            val d = day
            if (d == null) {
                item { CircularProgressIndicator() }
                note?.let { n -> item { Text(n, fontSize = 12.sp, textAlign = TextAlign.Center) } }
            } else {
                item {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp), horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(d.weekday.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colors.onSurfaceVariant)
                        Text(d.headline, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                        d.next?.let { n ->
                            Text("Next · " + n.whenText, fontSize = 11.sp, color = Lime)
                            Text(n.title, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                        }
                    }
                }
                note?.let { n -> item { Text(n, fontSize = 12.sp, color = Coral, textAlign = TextAlign.Center) } }
                item { ListHeader { Text(if (d.rocks.isEmpty()) "No Big Rocks today" else "Big Rocks") } }
                items(d.rocks, key = { "r" + it.id }) { r ->
                    val sub: String? = when {
                        r.overdue -> "Overdue · " + (r.day ?: "")
                        !r.time.isNullOrEmpty() -> r.time
                        else -> null
                    }
                    ToggleChip(
                        checked = r.done,
                        onCheckedChange = { want ->
                            day = d.copy(rocks = d.rocks.map { if (it.id == r.id) it.copy(done = want) else it })
                            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            scope.launch {
                                act(JSONObject().put("action", "rock").put("id", r.id).put("done", want), "r" + r.id) {
                                    day = day?.let { cur -> cur.copy(rocks = cur.rocks.map { if (it.id == r.id) it.copy(done = r.done) else it }) }
                                }
                            }
                        },
                        enabled = !busy.contains("r" + r.id),
                        label = { Text(r.title, maxLines = 3, overflow = TextOverflow.Ellipsis,
                            textDecoration = if (r.done) TextDecoration.LineThrough else null) },
                        secondaryLabel = if (sub != null) { { Text(sub, color = if (r.overdue) Coral else Color.Unspecified) } } else null,
                        toggleControl = { Checkbox(checked = r.done) },
                        colors = ToggleChipDefaults.toggleChipColors(checkedEndBackgroundColor = Lime.copy(alpha = 0.35f)),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                if (d.habits.isNotEmpty()) {
                    item { ListHeader { Text("Habits") } }
                    items(d.habits, key = { "h" + it.id }) { h ->
                        ToggleChip(
                            checked = h.done,
                            onCheckedChange = { want ->
                                day = d.copy(habits = d.habits.map { if (it.id == h.id) it.copy(done = want) else it })
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                scope.launch {
                                    act(JSONObject().put("action", "habit").put("id", h.id).put("done", want), "h" + h.id) {
                                        day = day?.let { cur -> cur.copy(habits = cur.habits.map { if (it.id == h.id) it.copy(done = h.done) else it }) }
                                    }
                                }
                            },
                            enabled = !busy.contains("h" + h.id),
                            label = { Text(h.name, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                            toggleControl = { Checkbox(checked = h.done) },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
                item {
                    Chip(onClick = { listen("rock", "Say the Big Rock") }, label = { Text("Add a Big Rock") },
                        secondaryLabel = { Text("By voice, for today") },
                        colors = ChipDefaults.primaryChipColors(backgroundColor = Coral, contentColor = Color(0xFF2A0F05)),
                        modifier = Modifier.fillMaxWidth())
                }
                item {
                    Chip(onClick = { listen("note", "Say the note") }, label = { Text("Add a note") },
                        secondaryLabel = { Text("Saved to your journal") },
                        colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth())
                }
                item {
                    Chip(onClick = { scope.launch { load() } }, label = { Text("Refresh") },
                        colors = ChipDefaults.secondaryChipColors(), modifier = Modifier.fillMaxWidth())
                }
                item {
                    if (!confirmUnlink) Chip(onClick = { confirmUnlink = true }, label = { Text("Unlink this watch", fontSize = 12.sp) },
                        colors = ChipDefaults.childChipColors(), modifier = Modifier.fillMaxWidth())
                    else Chip(onClick = { Store.forget(ctx); FlowComplicationService.refresh(ctx); onUnlinked() },
                        label = { Text("Tap again to unlink", fontSize = 12.sp, color = Coral) },
                        colors = ChipDefaults.childChipColors(), modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}
