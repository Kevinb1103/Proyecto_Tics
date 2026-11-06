import socket
import struct
import time
import math

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
destino = ("127.0.0.1", 5000)   # tu propio PC, puerto 5000

inicio = time.time()
while True:
    t = time.time() - inicio               # segundos desde que partió
    angulo = 45 + 35 * math.sin(t)         # sube y baja entre 10° y 80°
    rad = math.radians(angulo)

    ax = int(16384 * math.sin(rad))
    ay = 0
    az = int(16384 * math.cos(rad))
    gx = gy = gz = 0
    tiempo_ms = int(t * 1000)
    nodo = 1

    paquete = struct.pack('<BIhhhhhh', nodo, tiempo_ms, ax, ay, az, gx, gy, gz)

    sock.sendto(paquete,destino)

    time.sleep(0.01)    # ~100 Hz, como el ESP32