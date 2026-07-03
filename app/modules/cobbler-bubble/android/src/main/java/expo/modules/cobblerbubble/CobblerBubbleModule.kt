package expo.modules.cobblerbubble

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CobblerBubbleModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context lost" }

  override fun definition() = ModuleDefinition {
    Name("CobblerBubble")

    Function("canDrawOverlays") {
      Settings.canDrawOverlays(context)
    }

    Function("requestOverlayPermission") {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${context.packageName}"),
      )
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("show") { mood: String? ->
      if (!Settings.canDrawOverlays(context)) return@Function false
      val intent = Intent(context, BubbleService::class.java)
      intent.putExtra(BubbleService.EXTRA_MOOD, mood ?: "calm")
      if (Build.VERSION.SDK_INT >= 26) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      true
    }

    Function("hide") {
      context.stopService(Intent(context, BubbleService::class.java))
    }

    Function("isShowing") {
      BubbleService.running
    }
  }
}
