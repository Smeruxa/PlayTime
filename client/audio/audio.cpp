#include "audio.hpp"
#include <nlohmann/json.hpp>
#include <atomic>

std::atomic<bool> running{ true };

Audio::Audio(int sampleRate, int channels, int frameSize, int bitrate)
    : sampleRate(sampleRate), channels(channels), frameSize(frameSize), bitrate(bitrate), encoder(nullptr), decoder(nullptr), stream_in(nullptr) {
    initialize();
}

Audio::~Audio() {
    running = false;
    if (encoder) {
        opus_encoder_destroy(encoder);
    }
    if (decoder) {
        opus_decoder_destroy(decoder);
    }
    if (stream_in) {
        Pa_StopStream(stream_in);
        Pa_CloseStream(stream_in);
    }
    Pa_Terminate();
}

void Audio::initialize() {
    Pa_Initialize();
    Pa_OpenDefaultStream(&stream_in, channels, 0, paInt16, sampleRate, frameSize, nullptr, nullptr);
    Pa_StartStream(stream_in);

    encoder = opus_encoder_create(sampleRate, channels, OPUS_APPLICATION_VOIP, nullptr);
    decoder = opus_decoder_create(sampleRate, channels, nullptr);

    opus_encoder_ctl(encoder, OPUS_SET_BITRATE(bitrate));
}

void Audio::processAudio() {
    short input[FRAME_SIZE];
    unsigned char encoded[MAX_PACKET_SIZE];
    int encoded_bytes;

    while (running) {
        Pa_ReadStream(stream_in, input, frameSize);

        encoded_bytes = opus_encode(encoder, input, frameSize, encoded, MAX_PACKET_SIZE);
        if (encoded_bytes < 0) {
            std::cerr << "Opus декод ошибка: " << opus_strerror(encoded_bytes) << std::endl;
            break;
        }

        nlohmann::json response = {
             { "type", "voice" },
             { "timestamp", std::chrono::duration_cast<std::chrono::milliseconds>(
                   std::chrono::system_clock::now().time_since_epoch()).count() },
             { "message", std::vector<unsigned char>(encoded, encoded + encoded_bytes) }
        };

        server->send_message(response.dump());
    }
}

void Audio::start(Server* server) {
    this->server = server;
    std::async(std::launch::async, &Audio::processAudio, this);
}
