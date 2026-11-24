package com.playtimemobile

import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class KeyboardInsetsTest {
    @Test
    fun mainActivityKeepsComposerAboveEntireImeForGestureAndThreeButtonNavigation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val content = activity.findViewById<View>(android.R.id.content)
                for (navigationBottom in listOf(24, 48, 63)) {
                    val visible =
                        WindowInsetsCompat.Builder()
                            .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, 800))
                            .setInsets(
                                WindowInsetsCompat.Type.navigationBars(),
                                Insets.of(0, 0, 0, navigationBottom),
                            )
                            .build()
                    ViewCompat.dispatchApplyWindowInsets(content, visible)
                    assertEquals(
                        "IME includes navigation; never subtract it",
                        800,
                        content.paddingBottom,
                    )
                    val hidden =
                        WindowInsetsCompat.Builder()
                            .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
                            .setInsets(
                                WindowInsetsCompat.Type.navigationBars(),
                                Insets.of(0, 0, 0, navigationBottom),
                            )
                            .build()
                    ViewCompat.dispatchApplyWindowInsets(content, hidden)
                    assertEquals(
                        "SafeArea owns navigation when keyboard is hidden",
                        0,
                        content.paddingBottom,
                    )
                }
            }
        }
    }
}
