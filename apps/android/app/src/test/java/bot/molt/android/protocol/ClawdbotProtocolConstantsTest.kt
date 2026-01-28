package bot.molt.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class EspadaProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", EspadaCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", EspadaCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", EspadaCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", EspadaCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", EspadaCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", EspadaCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", EspadaCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", EspadaCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", EspadaCapability.Canvas.rawValue)
    assertEquals("camera", EspadaCapability.Camera.rawValue)
    assertEquals("screen", EspadaCapability.Screen.rawValue)
    assertEquals("voiceWake", EspadaCapability.VoiceWake.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", EspadaScreenCommand.Record.rawValue)
  }
}
