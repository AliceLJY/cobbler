package expo.modules.cobblerbubble

import android.animation.ValueAnimator
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import kotlin.math.abs

class BubbleService : Service() {

  companion object {
    @Volatile var running = false
    const val EXTRA_MOOD = "mood"
    private const val CHANNEL_ID = "cobbler-bubble"
    private const val NOTIFICATION_ID = 42
  }

  private var windowManager: WindowManager? = null
  private var bubbleView: BubbleView? = null
  private var layoutParams: WindowManager.LayoutParams? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    startInForeground()
    addBubble()
    running = true
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    intent?.getStringExtra(EXTRA_MOOD)?.let { bubbleView?.mood = it }
    return START_STICKY
  }

  override fun onDestroy() {
    bubbleView?.let { runCatching { windowManager?.removeView(it) } }
    bubbleView = null
    running = false
    super.onDestroy()
  }

  private fun startInForeground() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      val channel = NotificationChannel(CHANNEL_ID, "Cobbler 屏上泡泡", NotificationManager.IMPORTANCE_MIN)
      channel.description = "让 Cobbler 待在你屏幕上"
      manager.createNotificationChannel(channel)
    }
    val notification: Notification = if (Build.VERSION.SDK_INT >= 26) {
      Notification.Builder(this, CHANNEL_ID)
        .setContentTitle("Cobbler 在你屏上")
        .setContentText("水开着。")
        .setSmallIcon(android.R.drawable.presence_online)
        .setOngoing(true)
        .build()
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
        .setContentTitle("Cobbler 在你屏上")
        .setSmallIcon(android.R.drawable.presence_online)
        .setOngoing(true)
        .build()
    }
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun addBubble() {
    if (Build.VERSION.SDK_INT < 26) return // 现代设备为主,老系统不显示
    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    windowManager = wm
    val density = resources.displayMetrics.density
    val sizePx = (64 * density).toInt()

    val params = WindowManager.LayoutParams(
      sizePx, sizePx,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    )
    params.gravity = Gravity.TOP or Gravity.START
    params.x = resources.displayMetrics.widthPixels - sizePx - (8 * density).toInt()
    params.y = (resources.displayMetrics.heightPixels * 0.35f).toInt()
    layoutParams = params

    val view = BubbleView(this)
    bubbleView = view
    view.setOnTouchListener(DragTapListener(wm, params, view) { openApp() })
    wm.addView(view, params)
  }

  private fun openApp() {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    startActivity(launch)
  }

  /** 拖动跟手 + 松手贴边吸附;位移小且时间短 = tap */
  private inner class DragTapListener(
    private val wm: WindowManager,
    private val params: WindowManager.LayoutParams,
    private val view: View,
    private val onTap: () -> Unit,
  ) : View.OnTouchListener {
    private var startX = 0
    private var startY = 0
    private var touchX = 0f
    private var touchY = 0f
    private var downAt = 0L

    override fun onTouch(v: View, event: MotionEvent): Boolean {
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          startX = params.x
          startY = params.y
          touchX = event.rawX
          touchY = event.rawY
          downAt = System.currentTimeMillis()
          return true
        }
        MotionEvent.ACTION_MOVE -> {
          params.x = startX + (event.rawX - touchX).toInt()
          params.y = startY + (event.rawY - touchY).toInt()
          runCatching { wm.updateViewLayout(view, params) }
          return true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          val dx = abs(event.rawX - touchX)
          val dy = abs(event.rawY - touchY)
          val quick = System.currentTimeMillis() - downAt < 300
          if (dx < 12 && dy < 12 && quick) {
            onTap()
          } else {
            snapToEdge()
          }
          return true
        }
      }
      return false
    }

    private fun snapToEdge() {
      val screenW = view.resources.displayMetrics.widthPixels
      val target = if (params.x + view.width / 2 < screenW / 2) 0 else screenW - view.width
      val animator = ValueAnimator.ofInt(params.x, target)
      animator.duration = 180
      animator.addUpdateListener { a ->
        params.x = a.animatedValue as Int
        runCatching { wm.updateViewLayout(view, params) }
      }
      animator.start()
    }
  }

  /** 自绘简笔 Cobbler 小脸:黑圆身 + 白点眼 + 粉天线,与 app 内形象同基因 */
  private class BubbleView(context: Context) : View(context) {
    var mood: String = "calm"
      set(value) { field = value; invalidate() }

    private val body = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#111111") }
    private val eye = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val tip = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#FF5DA2") }

    override fun onDraw(canvas: Canvas) {
      super.onDraw(canvas)
      val w = width.toFloat()
      val h = height.toFloat()
      val cx = w / 2f
      val r = w * 0.42f
      val cy = h - r - h * 0.04f
      // 天线
      canvas.drawRect(cx - w * 0.015f, cy - r - h * 0.12f, cx + w * 0.015f, cy - r, body)
      canvas.drawCircle(cx, cy - r - h * 0.14f, w * 0.06f, tip)
      // 身体
      canvas.drawCircle(cx, cy, r, body)
      // 眼睛(V1 全 mood 圆点眼;表情分化留第二步)
      val eyeR = w * 0.055f
      canvas.drawCircle(cx - r * 0.38f, cy - r * 0.12f, eyeR, eye)
      canvas.drawCircle(cx + r * 0.38f, cy - r * 0.12f, eyeR, eye)
    }
  }
}
