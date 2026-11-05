from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import asyncio
from udp.receptor import ReceptorESP32
from api.websocket_manager import manager

app = FastAPI(title="Servidor Biomecánica - TICs I")

# Servir los archivos web de Kevin (HTML, CSS, JS) desde /frontend
app.mount("/static", StaticFiles(directory="../frontend"), name="static")

@app.on_event("startup")
async def iniciar_servicios():
    loop = asyncio.get_running_loop()
    transport, protocol = await loop.create_datagram_endpoint(
        lambda: ReceptorESP32(),
        local_addr=("0.0.0.0", 5000)
    )
    app.state.udp_transport = transport
    print("Servidor UDP corriendo en puerto 5000 y WebSocket listo en /ws")

@app.on_event("shutdown")
async def apagar_servicios():
    if hasattr(app.state, "udp_transport"):
        app.state.udp_transport.close()

# Endpoint para la conexión WebSocket del navegador
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Mantiene viva la conexión
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.get("/")
def home():
    return {"status": "Servidor REST, UDP y WebSocket activos"}