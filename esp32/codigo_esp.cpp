#include <Wire.h>
#include <WiFi.h>
#include <WiFiUdp.h>

const int MPU_ADDR = 0x68;
const char* ssid = "fh_500e50"; 
const char* password = "wlanaff1af";
const char* udpAddress = "192.168.1.29"; // Tu IP
const int udpPort = 5000;

WiFiUDP udp;

// El nuevo contrato binario (17 bytes exactos)
struct __attribute__((packed)) Payload {
  uint8_t nodo_id;
  uint32_t tiempo;
  int16_t acX, acY, acZ;
  int16_t gyX, gyY, gyZ;
};

Payload datos;

void setup() {
  Serial.begin(115200);
  Wire.begin(8, 9);
  
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0);
  Wire.endTransmission(true);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  
  datos.nodo_id = 1; // ID fijo de este nodo
}

void loop() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B); 
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 14, true);

  datos.acX = Wire.read() << 8 | Wire.read();
  datos.acY = Wire.read() << 8 | Wire.read();
  datos.acZ = Wire.read() << 8 | Wire.read();
  
  // Consumimos los 2 bytes de temperatura para no desfasar el giroscopio
  int16_t Tmp = Wire.read() << 8 | Wire.read(); 
  
  datos.gyX = Wire.read() << 8 | Wire.read();
  datos.gyY = Wire.read() << 8 | Wire.read();
  datos.gyZ = Wire.read() << 8 | Wire.read();
  
  datos.tiempo = millis();

  // Disparamos el paquete binario
  udp.beginPacket(udpAddress, udpPort);
  udp.write((uint8_t*)&datos, sizeof(datos));
  udp.endPacket();

  delay(10);
}