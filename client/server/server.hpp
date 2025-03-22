#ifndef SERVER_H
#define SERVER_H

#include <sdkddkver.h>
#include <boost/asio.hpp>
#include <functional>
#include <string>
#include <thread>
#include <memory>

class Server {
public:
    Server(const std::string& ip, unsigned short port);
    ~Server();

    void register_receive(std::function<void(const std::string&)> callback);
    void send_message(const std::string& msg);

private:
    void start_receive();
    void receive_handler(const boost::system::error_code& error, std::size_t bytes_transferred);

    boost::asio::io_context io_context_;
    boost::asio::ip::udp::socket socket_;
    boost::asio::ip::udp::endpoint remote_endpoint_;
    std::thread io_thread_;
    std::function<void(const std::string&)> receive_callback_;
    std::array<char, 8192> receive_buffer_;
};

#endif // SERVER_H