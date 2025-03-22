#include "play.hpp"
#include <iostream>
#include <vector>
#include <mutex>
#include <atomic>
#include <thread>
#include <cstring>

std::mutex audio_mutex;
std::condition_variable audio_cv;
std::vector<std::vector<short>> audio_buffers;
std::atomic<bool> stop_flag{ false };

Play::Play() : decoder(nullptr), stream_out(nullptr), playback_thread(nullptr) {
    initialize();
}

Play::~Play() {
    stop_flag = true;
    audio_cv.notify_all();
    if (playback_thread && playback_thread->joinable()) {
        playback_thread->join();
    }
    if (decoder) {
        opus_decoder_destroy(decoder);
    }
    if (stream_out) {
        Pa_StopStream(stream_out);
        Pa_CloseStream(stream_out);
    }
    Pa_Terminate();
}

void Play::initialize() {
    Pa_Initialize();
    Pa_OpenDefaultStream(&stream_out, 0, 1, paInt16, 48000, 960, nullptr, nullptr);
    Pa_StartStream(stream_out);
    decoder = opus_decoder_create(48000, 1, nullptr);
    playback_thread = std::make_unique<std::thread>(&Play::audioPlaybackThread, this);
}

void Play::processAudio(const std::vector<unsigned char>& encoded) {
    short output[960] = {0};
    int decoded_bytes = opus_decode(decoder, encoded.data(), encoded.size(), output, 960, 0);
    if (decoded_bytes < 0) {
        std::cerr << "Opus декод ошибка: " << opus_strerror(decoded_bytes) << std::endl;
        return;
    }

    std::lock_guard<std::mutex> lock(audio_mutex);
    audio_buffers.push_back(std::vector<short>(output, output + 960));
    audio_cv.notify_one();
}

void Play::audioPlaybackThread() {
    short mixed_output[960] = {0};
    while (!stop_flag) {
        std::unique_lock<std::mutex> lock(audio_mutex);
        audio_cv.wait(lock, [] { return !audio_buffers.empty() || stop_flag; });
        if (stop_flag) break;

        memset(mixed_output, 0, sizeof(mixed_output));

        for (auto& buffer : audio_buffers) {
            for (size_t i = 0; i < 960; ++i) {
                int mixed_sample = mixed_output[i] + buffer[i];
                mixed_output[i] = std::clamp(mixed_sample, -32768, 32767);
            }
        }

        audio_buffers.clear();

        lock.unlock();

        Pa_WriteStream(stream_out, mixed_output, 960);
    }
}

void Play::play_received(Server* server) {
    server->register_receive([this](const std::string& message) {
        try {
            auto json_data = nlohmann::json::parse(message);
            if (json_data["type"] == "voice") {
                std::vector<unsigned char> encoded = json_data["message"].get<std::vector<unsigned char>>();
                processAudio(encoded);
            }
        }
        catch (const std::exception& e) {
            std::cerr << "Ошибка обработки сообщения: " << e.what() << std::endl;
        }
    });
}
