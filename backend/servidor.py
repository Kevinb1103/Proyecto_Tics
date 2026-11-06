import asyncio
import socket
import struct
import json
import math
import websockets

clientes = set()          # navegadores conectados
ANGULO_PATRON = 45.0      # provisorio: después vendrá de la BD
ENVIAR_CADA = 5           # 100 Hz / 5 = 20 Hz hacia el navegador


async def manejar_web(websocket):
    """Se ejecuta cada vez que un navegador se conecta."""
    clientes.add(websocket)
    print("Página web conectada")
    try:
        await websocket.wait_closed()   # espera sin bloquear hasta que se cierre
    finally:
        clientes.discard(websocket)
        print("Página web desconectada")


async def recibir_udp():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", 5000))
    sock.setblocking(False)             # requisito para usarlo con asyncio
    loop = asyncio.get_running_loop()
    print("Escuchando UDP en el puerto 5000...")

    contador = 0
    while True:
        # Igual que recvfrom, pero con await: mientras espera, el
        # servidor WebSocket sigue atendiendo navegadores
        data, addr = await loop.sock_recvfrom(sock, 1024)
        if len(data) != 17:
            continue

        nodo, t, ax, ay, az, gx, gy, gz = struct.unpack("<BIhhhhhh", data)

        angulo = math.degrees(math.atan2(ax,az))

        contador += 1
        if contador % ENVIAR_CADA != 0:
            continue

        payload = {"angulo_actual": angulo,
                   "angulo_patron": ANGULO_PATRON,
                   "nodo_timeout": None}
        
        websockets.broadcast(clientes, json.dumps(payload))


async def main():
    async with websockets.serve(manejar_web, "127.0.0.1", 8000):
        print("WebSocket en ws://127.0.0.1:8000")
        await recibir_udp()


if __name__ == "__main__":
    asyncio.run(main())