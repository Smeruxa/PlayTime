#include "server/server.hpp"
#include "audio/audio.hpp"
#include "audio/play/play.hpp"
#include <iostream>
#include <thread>

int main() {
    setlocale(LC_ALL, "ru");
    Server server("000.000.000.000", 0000);

    Play play;
    play.play_received(&server);

    Audio audio;
    audio.start(&server);

    while (true) {
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    return 0;
}
