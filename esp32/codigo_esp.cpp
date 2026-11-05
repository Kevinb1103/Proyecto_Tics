#include <Wire.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// Dirección de memoria del sensor MPU6050
const int MPU_ADDR = 0x68;
// Variables para guardar la aceleración, temperatura y giroscopio
int16_t AcX, AcY, AcZ, Tmp, GyX, GyY, GyZ;

// Datos de tu Wi-Fi
const char* ssid = "fh_500e50"; 
const char* password = "wlanaff1af";

// !!! AQUÍ ESTÁ LA MAGIA !!!
// Cambia esto por la IP que te dio el ipconfig en el notebook
const char* udpAddress = "192.168.1.29"; 

const String NODO_ID = "Nodo_01";
WiFiUDP udp;
const int udpPort = 5000; // El puerto por donde escucha Python

void setup() {
  Serial.begin(115200); // Iniciamos el monitor serie para leer mensajes
  Serial.println("\nHolo, iniciando..."); 
  
  Wire.begin(8, 9); // Le decimos qué pines del ESP32 leen el sensor
  
  // Despertamos al sensor (viene dormido de fábrica)
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0);
  Wire.endTransmission(true);

  Serial.print("Conectando al Wi-Fi...");
  WiFi.begin(ssid, password);
  
  // Esperamos dando vueltas hasta que el router nos de señal
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\n¡Wi-Fi conectado! IP de este nodo: ");
  Serial.println(WiFi.localIP());
  Serial.println("Nodo iniciando captura 6-DOF...");
}

void loop() {
  // Le pedimos al sensor que nos empiece a tirar los datos crudos
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B); 
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 14, true);

  // Armamos los números de aceleración (X, Y, Z)
  AcX = Wire.read() << 8 | Wire.read();
  AcY = Wire.read() << 8 | Wire.read();
  AcZ = Wire.read() << 8 | Wire.read();
  Tmp = Wire.read() << 8 | Wire.read(); 
  // Armamos los números de rotación/giroscopio (X, Y, Z)
  GyX = Wire.read() << 8 | Wire.read();
  GyY = Wire.read() << 8 | Wire.read();
  GyZ = Wire.read() << 8 | Wire.read();

  unsigned long tiempo = millis(); // Tomamos el tiempo actual

  // Empaquetamos todo en una sola línea de texto separada por comas
  String paquete = NODO_ID + "," + 
    String(tiempo) + "," + 
    String(AcX) + "," + 
    String(AcY) + "," + 
    String(AcZ) + "," + 
    String(GyX) + "," + 
    String(GyY) + "," + 
    String(GyZ);

  // Disparamos el paquete de texto por Wi-Fi hacia tu notebook
  udp.beginPacket(udpAddress, udpPort);
  udp.print(paquete);
  udp.endPacket();

  Serial.println(paquete); // Lo mostramos en pantalla por si acaso
  
  delay(10); // Esperamos un milisegundo cagón para enviar 100 veces por segundo
}