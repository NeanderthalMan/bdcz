package n12n.beadcause

import android.net.Uri
import android.os.Bundle
import android.view.ActionMode
import android.view.Menu
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import n12n.beadcause.databinding.ActivityDocBinding

/**
 * The reader tab, as a real screen.
 *
 * In the browser a `/doc?p=…` link opens a second tab so the question — and any
 * half-written answer — is still there when you come back. Here it's a second
 * activity, which gets the same effect from the system back button.
 *
 * No token is passed in the URL: `doc.html` reads it from localStorage, and this
 * WebView shares the app's storage with MainActivity because it's the same origin.
 */
class DocActivity : AppCompatActivity() {

    private lateinit var binding: ActivityDocBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityDocBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val url = intent.data ?: return finish()
        binding.toolbar.setNavigationOnClickListener { finish() }
        binding.toolbar.title = url.getQueryParameter("p")?.substringAfterLast('/') ?: getString(R.string.doc_title)

        with(binding.webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
        }

        val host = Uri.parse(Prefs.baseUrl(this).orEmpty()).host
        binding.webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // A doc can link onward. Stay in the reader for our own pages, and
                // send anything else out the same way a brief's links go — a Custom
                // Tab on top of this one, not a trip to another app.
                if (request.url.host == host) return false
                Links.open(this@DocActivity, request.url)
                return true
            }

            override fun onPageFinished(view: WebView, url: String?) {
                binding.progress.visibility = View.GONE
                // doc.html carries a header for the browser tab it was written for.
                // Under the native toolbar that's a duplicate title, and its ✕ calls
                // window.close() — which a WebView ignores, so it's a button that
                // does nothing. Drop it. Safe here: doc.js reads #doc-title and
                // #doc-close synchronously while parsing, long before this runs.
                view.evaluateJavascript("document.querySelector('.doc-body > .topbar')?.remove();", null)
                // The notes layer's own floating bar would sit under the system's
                // selection toolbar, which gets the same two items below instead.
                view.evaluateJavascript("window.beadcause?.docnotes && (window.beadcause.docnotes.native = true);", null)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.webView.canGoBack()) binding.webView.goBack() else finish()
            }
        })

        binding.webView.loadUrl(url.toString())
    }

    /**
     * Comment / Suggest edit on the WebView's own text-selection toolbar (bc-03vg2.2).
     *
     * A long-press in a WebView opens the system's selection ActionMode, and it covers
     * anything the page floats near the selection. So the page's two actions join that
     * toolbar here and call straight into public/docnotes.js, which reads the selection
     * itself — `open` runs before `finish()` clears it.
     */
    override fun onActionModeStarted(mode: ActionMode) {
        super.onActionModeStarted(mode)
        val menu = mode.menu
        if (menu.findItem(ID_COMMENT) != null) return
        fun add(id: Int, title: Int, kind: String) {
            menu.add(Menu.NONE, id, 0, title).setOnMenuItemClickListener {
                binding.webView.evaluateJavascript("window.beadcause?.docnotes?.open('$kind');") { mode.finish() }
                true
            }
        }
        add(ID_COMMENT, R.string.doc_note_comment, "comment")
        add(ID_SUGGEST, R.string.doc_note_suggest, "suggest")
    }

    override fun onDestroy() {
        binding.webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val ID_COMMENT = 0x0d0c1
        const val ID_SUGGEST = 0x0d0c2
    }
}
