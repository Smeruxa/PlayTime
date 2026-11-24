package com.playtime.audiofixture;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(40, 100, 40, 40);
        TextView title = new TextView(this);
        title.setText("Audio capture fixture · 880 Hz\nSeparate Android UID; no microphone permission.");
        title.setTextSize(20);
        layout.addView(title);
        Button play = new Button(this);
        play.setText("Play external 880 Hz tone");
        play.setOnClickListener(view -> startForegroundService(new Intent(this, ToneService.class)));
        layout.addView(play);
        Button stop = new Button(this);
        stop.setText("Stop tone");
        stop.setOnClickListener(view -> stopService(new Intent(this, ToneService.class)));
        layout.addView(stop);
        setContentView(layout);
    }
}
