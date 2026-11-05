from fastapi import WebSocket
from typing import List

class ConnectionManager:
    def __init__(self):
        # Lista de clientes web conectados en tiempo real
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print("Cliente web de Kevin conectado al WebSocket")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print("Cliente web desconectado")

    async def broadcast(self, data: dict):
        # Transmite el JSON de telemetría a todos los clientes web conectados
        for connection in self.active_connections:
            try:
                await connection.send_json(data)
            except Exception:
                # Si un cliente falla, se remueve silenciosamente
                pass

manager = ConnectionManager()