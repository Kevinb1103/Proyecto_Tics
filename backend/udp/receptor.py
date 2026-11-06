import asyncio
import struct
from api.websocket_manager import manager

class ReceptorESP32(asyncio.DatagramProtocol):
    def connection_made(self, transport):
        self.transport = transport
        print("Puerto UDP 5000 abierto. Escuchando telemetría inercial...")

    def datagram_received(self, data, addr):
        # 1. Validación de tamaño (17 bytes exactos)
        if len(data) != 17:
            return

        try:
            # 2. Desempaquetado Little-Endian
            datos = struct.unpack('<BIhhhhhh', data)

            nodo_id = datos[0]
            tiempo_ms = datos[1]
            acX, acY, acZ = datos[2], datos[3], datos[4]
            gyX, gyY, gyZ = datos[5], datos[6], datos[7]

            # 3. Formateo de payload para el Frontend de Kevin
            payload = {
                "nodo_id": nodo_id,
                "tiempo_ms": tiempo_ms,
                "acel": {"x": acX, "y": acY, "z": acZ},
                "giro": {"x": gyX, "y": gyY, "z": gyZ}
            }

            # 4. Transmisión asíncrona al WebSocket en segundo plano
            loop = asyncio.get_running_loop()
            loop.create_task(manager.broadcast(payload))

        except struct.error:
            pass