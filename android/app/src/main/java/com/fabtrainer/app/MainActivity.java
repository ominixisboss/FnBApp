package com.fabtrainer.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // keep the area behind hidden bars / the camera cut-out the same dark colour as the game
        getWindow().getDecorView().setBackgroundColor(0xFF14110F);
        goFullscreen();
    }

    @Override
    public void onResume() {
        super.onResume();
        goFullscreen();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // re-hide the bars after dialogs, the keyboard, or returning from another app
        if (hasFocus) goFullscreen();
    }

    /** Immersive full screen: status and navigation bars hidden; swiping from an edge shows them briefly. */
    private void goFullscreen() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }
}
