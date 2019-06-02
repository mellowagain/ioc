---
title: Reverse Engineering a Protocol Impossible to Reverse Engineer
description: A overview of how the osu! client and the osu!Bancho server communicate with each other
author: Mari
authorUrl: https://twitter.com/mari3842h
image: /static/img/4ad00a15-6445-4bd5-938b-e7aed9740a83.jpg
date: October 21, 2018
---

[Ripple][0], a 3rd party server for the video game [osu!][1], had the following sentences
on their landing page since literally forever:

> ~~reverse engineering a protocol impossible to reverse engineer since always~~
> we are actually reverse engineering bancho successfully. for the third time.

But how much truth is behind these sentences? In this article I will give a quick
overview in how the osu! client and the osu!Bancho server communicate with each other
and how I've gone ahead and figured these things out.

## Sniffing the traffic between client and server

So let's start by opening up Wireshark and just capturing a few packets. You'll notice
quickly that the communication between the osu! client and the osu!Bancho server happens
using simple HTTP requests.

![Wireshark](/static/img/f8bcb43a-c0c5-4a2a-a9eb-8b71880b6098.png)

Normally, these would be sent over HTTPS but I've gone ahead and patched my client
to connect to osu!Bancho servers without HTTPS. If you want to decrypt the original
HTTPS traffic, just search up ways to decrypt HTTPS traffic in Wireshark.

## So much traffic today!

Immediately we notice that osu! seems to send a few checks to `/web/` routes, the first one
seems to check if my client is up-to-date, as you can see from the parameters it sends.

Next up osu! sends a request to `/web/bancho_connect.php`. Now this is interesting. This
seems to be a pre-connection mechanism by osu! for eventual ban checking or something. It just
seems to return the registration country if supplied with correct parameters. Because this
query contains the md5sum of my password and my unique client hash, I've censored parts of it.

We also see a few POST requests to `/web/osu_error.php`. osu! automatically sends the whole
client information to that endpoint in case a error occurs, and because a few routes returned
404 (because I conveniently null-routed them) - that shows up a few times.

## Authentication

But now lets get to the actual interesting part. osu! sends a POST request to the `/` endpoint.
Looking at the body sent, it seems to be login and client information. This is the request
that authenticates us with the osu!Bancho server. The body is in the following format:

```
username
md5sum of the password
Version|UTC offset|Display full location|Colon seperated list of MAC addresses which are MD5 hashed|Block non-friend PMs

```

Funnily enough, because I'm running osu! on my Linux machine under Wine, the colon separated
list of MAC addresses contained a string which wasn't md5 hashed, it's value was `runningunderwine`.

Now let's take a look at what the server responded and...

![Response](/static/img/54f8c121-87fa-447f-82cb-2f2ebcaca801.png)

What the hell? Until now everything was nice and plain text and now we got some garbage data
with some strings between them? This doesn't seem right - well, actually, it does. We'll
be taking a look at them in the next section. Let's first address the headers that we see
because this is the first time the server set some headers on the response which seem interesting.

| Header | Description |
| ------ | ----------- |
| `cho-protocol` | This is the version of the cho-protocol used in this response. The newest version known as of the writing of this article is `19`. |
| `cho-token` | This is the authentication token used for future requests. Think of it like a session cookie. |
| `cho-server` | **This is a non-standard header**. It was set by this 3rd party server implementation for identification of the software. |

Now that this is out of the way, let's take a look at the seemingly random data mixed with strings
between them. This data is actually a array of cho packets. But how exactly is the format of one
cho packet?

## Disassembling one packet

Let's take a look at one packet sent from the server to the client:

```hex
18 00 00 0F 00 00 00 0B 0D 48 65 6C 6C 6F 2C 20 77 6F 72 6C 64 21
```

Looks pretty cryptic, doesn't it? But it isn't actually that hard. A cho packet has always
a seven byte header and the actual packet data after it. It is in the following format:

| Size | Description | Type |
| ---- | ----------- | ---- |
| 2 bytes | Packet ID | LE 16-bit Integer |
| 1 byte | Null byte | Backwards compatibility with the 2009 osu! client, no longer used. |
| 4 bytes | Packet Data Size | LE 32-bit Integer |

The remaining bytes after this header are all part of the actual packet body.

Using Python's `struct` module, we can easily translate the bytes above into human readable
data.

```python
>>> struct.unpack("<h", b"\x18\x00")[0]          # Packet ID
24
>>> struct.unpack("<i", b"\x0F\x00\x00\x00")[0]  # Packet Data Size
15
```

Great. As we can see the packet ID for our packet is `24`. I've compiled a list of known packets
in a Gist [here][2]. The packets prefixed with `in` are sent by the osu! client and the packets
prefixed with `out` are sent by the osu!Bancho server. Looking at the list, it seems we have
a announcement packet here.

```cpp
out_announce = 24,
```

and sending this exact packet to our osu! client confirms our thesis:

![Osu Ingame](/static/img/637b8d55-85d7-41dc-b2d1-2448222a1836.png)

We also got `15` for the packet data size and looking at the remaining bytes, they are
exactly 15. Great! Seems we're on a good way already. So let's continue reading the packet
body.

## Parsing the packet body

So let's jump right into it. The first byte we encounter is `0B`. It signalizes that the
following bytes should be interpreted as a non-empty string.

So let's try that, shall we?

```python
>>> b"\x0D\x48\x65\x6C\x6C\x6F\x2C\x20\x77\x6F\x72\x6C\x64\x21".decode("UTF-8")
'\rHello, world!'
```

But what's this? The string at the beginning has a carriage return. Is this actually correct?
Hint: it's not. But what is it then?

After some search on the Internet I encounter the osu! wiki. To be more precise, I encounter
the wiki page for the [`.osr` File Format][3]. A `.osr` file is a encoded osu! replay file
containing all cursor movement and button clicks. Looking at their table of data types,
we can see the following description:

> **String**
> Has three parts; a single byte which will be either 0x00, indicating that the next two parts are not present, or 0x0b (decimal 11), indicating that the next two parts are present. If it is 0x0b, there will then be a ULEB128, representing the byte length of the following string, and then the string itself, encoded in UTF-8.

Could peppy have decided to use the same format for strings in cho packets as well? Let's
try it out.

Based on the description, the byte after the `0B`, which in our case is `0D`, represents
the byte length of the following string. Let's convert this then.

```python
>>> 0x0D
13
```

Wow, what a coincidence! This is exactly the amount of the remaining bytes in our packet body.
Converting the remaining bytes into a UTF-8 string and we get the correct string:

```python
>>> b"\x48\x65\x6C\x6C\x6F\x2C\x20\x77\x6F\x72\x6C\x64\x21".decode("UTF-8")
'Hello, world!'
```

Success! We've successfully interpreted a cho packet containing a string as body. Let's try
interpreting one which doesn't have a string body.

## Don't you reply to me

The same HTTP body also contained another packet:

```
05 00 00 04 00 00 00 FF FF FF FF
```

Let's try parsing this. First we get again the packet ID and the packet data size.

```python
>>> struct.unpack("<h", b"\x05\x00")[0]          # Packet ID
5
>>> struct.unpack("<i", b"\x04\x00\x00\x00")[0]  # Packet Data Size
4
```

Looking again on the packet list, the packet seems to be a login reply.

```
out_login_reply = 5,
```

A login reply packet has exactly one argument, the user ID or error code. If the passed argument,
a signed 32-bit integer, is negative, a error occurred. If the argument is positive, it is the
user ID of user you logged into as.

So let's do that.

```python
>>> struct.unpack("<i", b"\xFF\xFF\xFF\xFF")[0]
-1
```

We see that we received a negative number. This indicates a error in the login process. Looking
at the list of errors we see that we sent invalid credentials.

```cpp
enum class login_responses : int32_t {
    invalid_credentials = -1,
    outdated_client = -2,
    user_banned = -3,
    multiaccount_detected = -4,
    server_error = -5,
    cutting_edge_multiplayer = -6,
    account_password_rest = -7,
    verification_required = -8
};
```

So we've also successfully parsed a packet which only contained a 32-bit integer as argument.
That was easy, wasn't it?

## Conclusion

As we've seen from this writeup, the cho protocol is in no means impossible to reverse engineer.
It follows the common principle of [Type-length-value][4], a encoding scheme used for optional
information elements.

I hope this little overview of the cho protocol gave you a better understanding of how
the osu! game client and the osu!Bancho server communicate with each other.

I have written this article to allow for new people to dig a bit deeper into the inner workings
of this beautiful rhythm game. The development community around osu! is amazing and has many
different aspects which may also interest you.

This guide does not apply to the open-source version of osu!, called osu!lazer. The osu!lazer
project uses JSON to communicate with the osu-web server (not osu!Bancho).

## Credits

This guide was created with the help of [czapek][5], a friend of mine with who I wrote a
server side implementation of the cho protocol, Shiro, which was used as osu!Bancho server
throughout this writeup.

Thanks to [Mempler][6] for demystifying a few values in the initial
login request sent by the osu! client.

[0]: https://ripple.moe
[1]: https://osu.ppy.sh
[2]: https://gist.github.com/Marc3842h/11a206737f767f7a6d1eea081c4730c9
[3]: https://osu.ppy.sh/help/wiki/osu!_File_Formats/Osr_(file_format)
[4]: https://en.wikipedia.org/wiki/Type-length-value
[5]: https://github.com/cyanidee
[6]: https://github.com/Mempler
