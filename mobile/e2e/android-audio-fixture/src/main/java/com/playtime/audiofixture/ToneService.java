package com.playtime.audiofixture;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.IBinder;

public final class ToneService extends Service {
    private volatile boolean running;
    private Thread worker;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String channel = "test-tone";
        getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(channel, "Audio capture test", NotificationManager.IMPORTANCE_LOW)
        );
        Notification notification = new Notification.Builder(this, channel)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("PlayTime test · 880 Hz tone")
            .setContentText("Stop in Audio Fixture when the test is complete")
            .setOngoing(true)
            .build();
        startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        if (!running) {
            running = true;
            worker = new Thread(this::playTone, "playtime-fixture-tone");
            worker.start();
        }
        return START_NOT_STICKY;
    }

    private void playTone() {
        AudioTrack track = new AudioTrack.Builder()
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_ALL)
                .build())
            .setAudioFormat(new AudioFormat.Builder()
                .setSampleRate(48000)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build())
            .setBufferSizeInBytes(9600)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build();
        try {
            track.play();
            short[] samples = new short[960];
            long frame = 0;
            while (running) {
                for (int index = 0; index < samples.length; index++) {
                    samples[index] = (short) (Math.sin(2 * Math.PI * 880 * frame++ / 48000) * 4000);
                }
                track.write(samples, 0, samples.length, AudioTrack.WRITE_BLOCKING);
            }
        } finally {
            track.stop();
            track.release();
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) {
            try {
                worker.join(1000);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
        }
        super.onDestroy();
    }
}
