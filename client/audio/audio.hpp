#ifndef AUDIO_HPP
#define AUDIO_HPP

#include "server/server.hpp"

#include <opus/opus.h>
#include <portaudio.h>
#include <iostream>

#define SAMPLE_RATE 48000
#define CHANNELS 1
#define FRAME_SIZE 960
#define MAX_PACKET_SIZE 8000
#define BITRATE 16000

class Audio {
public:
    Audio(int sampleRate = SAMPLE_RATE, int channels = CHANNELS, int frameSize = FRAME_SIZE, int bitrate = BITRATE);
    ~Audio();
    void start(Server* server);

private:
    int sampleRate;
    int channels;
    int frameSize;
    int bitrate;

    OpusEncoder* encoder;
    OpusDecoder* decoder;
    PaStream* stream_in;
    Server* server;

    void initialize();
    void processAudio();
};

#endif // AUDIO_HPP
