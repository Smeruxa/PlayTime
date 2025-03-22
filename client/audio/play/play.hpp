#ifndef PLAY_HPP
#define PLAY_HPP
#include "server/server.hpp"
#include <opus/opus.h>
#include <portaudio.h>
#include <nlohmann/json.hpp>
#include <vector>
#include <string>
#include <memory>
#include <thread>
class Play {
public:
    Play();
    ~Play();
    void play_received(Server* server);
    void audioPlaybackThread();
    void processAudio(const std::vector<unsigned char>& encoded);
private:
    void initialize();
    OpusDecoder* decoder;
    PaStream* stream_out;
    std::unique_ptr<std::thread> playback_thread;
};
#endif
