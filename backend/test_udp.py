import socket
import struct

# Socket UDP (AF_INET = IPv4, SOCK_DGRAM = UDP)
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
# Escuchar en el puerto 5000, en cualquier interfaz de este PC
sock.bind(("0.0.0.0", 5000))
print("Esperando paquetes en el puerto 5000...")

while True:
    # Espera hasta que llegue un paquete
    data, addr = sock.recvfrom(1024)

    if len(data) != 17:
        print("Paquete de tamaño inesperado:", len(data))
        continue

    # < = little-endian, B = 1 byte, I = 4 bytes, h = 2 bytes con signo (x6)
    nodo, t, ax, ay, az, gx, gy, gz = struct.unpack("<BIhhhhhh", data)
    print(nodo, t, ax, ay, az, gx, gy, gz)