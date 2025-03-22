#include "server.hpp"
#include <boost/asio.hpp>
#include <iostream>
#include <memory>

Server::Server(const std::string& ip, unsigned short port)
    : socket_(io_context_, boost::asio::ip::udp::endpoint(boost::asio::ip::udp::v4(), port)) {
    try {
        remote_endpoint_ = boost::asio::ip::udp::endpoint(boost::asio::ip::address::from_string(ip), port);
        io_thread_ = std::thread([this]() {
            try {
                start_receive();
                io_context_.run();
            }
            catch (const std::exception& e) {
                std::cout << "Ошибка в io_context: " << e.what() << std::endl;
            }
        });
    }
    catch (const std::exception& e) {
        std::cout << "Ошибка открытия сокета: " << e.what() << std::endl;
    }
}

Server::~Server() {
    io_context_.stop();
    if (io_thread_.joinable()) {
        io_thread_.join();
    }
}

void Server::register_receive(std::function<void(const std::string&)> callback) {
    receive_callback_ = std::move(callback);
}

void Server::send_message(const std::string& msg) {
    auto buffer = std::make_shared<std::string>(msg);
    socket_.async_send_to(
        boost::asio::buffer(*buffer), remote_endpoint_,
        [buffer](const boost::system::error_code& error, std::size_t /*bytes_transferred*/) {
            if (error) {
                std::cout << "Ошибка отправки сообщения: " << error.message() << std::endl;
            }
        });
}

void Server::start_receive() {
    try {
        socket_.async_receive_from(
            boost::asio::buffer(receive_buffer_), remote_endpoint_,
            [this](const boost::system::error_code& error, std::size_t bytes_transferred) {
                receive_handler(error, bytes_transferred);
            }
        );
    }
    catch (const std::exception& e) {
        std::cout << "Ошибка в start_receive: " << e.what() << std::endl;
    }
}

void Server::receive_handler(const boost::system::error_code& error, std::size_t bytes_transferred) {
    if (error) {
        std::cerr << "Ошибка при приеме сообщения (receive_handler): " << error.message() << std::endl;
        return;
    }

    std::string message(receive_buffer_.data(), bytes_transferred);
    if (receive_callback_) {
        receive_callback_(message);
    }

    start_receive();
}
