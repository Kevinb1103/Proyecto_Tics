import asyncio
import websockets
import json
import math
import random

async def enviar_telemetria(websocket):
    print("¡Página web conectada al servidor!")
    paso = 0
    try:
        while True:
            paso += 0.1
            patron = 45 + 35 * math.sin(paso)
            actual = patron + random.uniform(-5, 5) # Temblor
            
            payload = {
                "angulo_actual": actual,
                "angulo_patron": patron,
                "nodo_timeout": None
            }
            await websocket.send(json.dumps(payload))
            await asyncio.sleep(0.1)
    except websockets.exceptions.ConnectionClosed:
        print("Página web desconectada.")

async def main():
    # Servidor abierto sin restricciones de ruta
    async with websockets.serve(enviar_telemetria, "127.0.0.1", 8000):
        print("Servidor WebSocket esperando conexión en ws://127.0.0.1:8000")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())