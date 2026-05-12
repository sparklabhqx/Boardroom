#include <Arduino.h>
#include <ESPmDNS.h>
#include <Update.h>
#include <WebServer.h>
#include <WiFi.h>

// Configure these before the first USB flash.
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char *DEVICE_NAME = "Boardroom ESP32";
const char *FIRMWARE_VERSION = "0.1.0";

const int GPIO_PINS[] = {2, 4, 5, 12, 13};
const size_t BOARDROOM_GPIO_PIN_COUNT = sizeof(GPIO_PINS) / sizeof(GPIO_PINS[0]);

WebServer server(80);

String logLines[24];
uint8_t logCursor = 0;
bool shouldReboot = false;

void addLog(const String &line) {
  String stamped = String(millis() / 1000) + "s " + line;
  logLines[logCursor] = stamped;
  logCursor = (logCursor + 1) % 24;
  Serial.println(stamped);
}

void sendCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void sendJson(int code, const String &json) {
  sendCorsHeaders();
  server.send(code, "application/json", json);
}

String jsonEscape(const String &value) {
  String escaped = "";
  for (size_t index = 0; index < value.length(); index++) {
    char current = value.charAt(index);
    if (current == '"' || current == '\\') escaped += '\\';
    escaped += current;
  }
  return escaped;
}

String chipId() {
  uint64_t mac = ESP.getEfuseMac();
  char buffer[17];
  snprintf(buffer, sizeof(buffer), "%04X%08X", (uint16_t)(mac >> 32), (uint32_t)mac);
  return String(buffer);
}

bool configuredPin(int pin) {
  for (size_t index = 0; index < BOARDROOM_GPIO_PIN_COUNT; index++) {
    if (GPIO_PINS[index] == pin) return true;
  }
  return false;
}

int extractJsonNumber(const String &body, const String &key, int fallback) {
  int keyIndex = body.indexOf("\"" + key + "\"");
  if (keyIndex < 0) return fallback;
  int colon = body.indexOf(':', keyIndex);
  if (colon < 0) return fallback;
  int start = colon + 1;
  while (start < (int)body.length() && isspace(body.charAt(start))) start++;
  int end = start;
  while (end < (int)body.length() && (isDigit(body.charAt(end)) || body.charAt(end) == '-')) end++;
  return body.substring(start, end).toInt();
}

void handleOptions() {
  sendCorsHeaders();
  server.send(204);
}

void handleInfo() {
  String json = "{";
  json += "\"deviceName\":\"" + jsonEscape(DEVICE_NAME) + "\",";
  json += "\"firmwareVersion\":\"" + jsonEscape(FIRMWARE_VERSION) + "\",";
  json += "\"chipId\":\"" + chipId() + "\",";
  json += "\"uptime\":" + String(millis() / 1000) + ",";
  json += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  json += "\"heap\":" + String(ESP.getFreeHeap()) + ",";
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\"";
  json += "}";
  sendJson(200, json);
}

void handleGpioGet() {
  String json = "{\"pins\":[";
  for (size_t index = 0; index < BOARDROOM_GPIO_PIN_COUNT; index++) {
    int pin = GPIO_PINS[index];
    if (index > 0) json += ",";
    json += "{\"pin\":" + String(pin) + ",\"value\":" + String(digitalRead(pin) == HIGH ? 1 : 0) + "}";
  }
  json += "]}";
  sendJson(200, json);
}

void handleGpioPost() {
  String body = server.arg("plain");
  int pin = extractJsonNumber(body, "pin", -1);
  int value = extractJsonNumber(body, "value", -1);

  if (!configuredPin(pin) || (value != 0 && value != 1)) {
    sendJson(400, "{\"error\":\"Expected configured pin and value 0 or 1\"}");
    return;
  }

  digitalWrite(pin, value == 1 ? HIGH : LOW);
  addLog("GPIO " + String(pin) + " set to " + String(value));
  sendJson(200, "{\"ok\":true}");
}

void handleLogs() {
  String json = "{\"logs\":[";
  bool first = true;
  for (size_t offset = 0; offset < 24; offset++) {
    uint8_t index = (logCursor + offset) % 24;
    if (logLines[index].length() == 0) continue;
    if (!first) json += ",";
    json += "\"" + jsonEscape(logLines[index]) + "\"";
    first = false;
  }
  json += "]}";
  sendJson(200, json);
}

void handleUpdateDone() {
  sendCorsHeaders();
  if (Update.hasError()) {
    addLog("OTA update failed");
    server.send(500, "text/plain", "Update failed");
    return;
  }

  addLog("OTA update complete, rebooting");
  server.send(200, "text/plain", "Update successful. Rebooting.");
  shouldReboot = true;
}

void handleUpdateUpload() {
  HTTPUpload &upload = server.upload();

  if (upload.status == UPLOAD_FILE_START) {
    addLog("OTA upload started: " + upload.filename);
    if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
      Update.printError(Serial);
      addLog("OTA begin failed");
    }
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
      Update.printError(Serial);
      addLog("OTA write failed");
    }
  } else if (upload.status == UPLOAD_FILE_END) {
    if (Update.end(true)) {
      addLog("OTA image written: " + String(upload.totalSize) + " bytes");
    } else {
      Update.printError(Serial);
      addLog("OTA end failed");
    }
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    Update.end();
    addLog("OTA upload aborted");
  }
}

void setupRoutes() {
  server.on("/api/info", HTTP_OPTIONS, handleOptions);
  server.on("/api/gpio", HTTP_OPTIONS, handleOptions);
  server.on("/api/logs", HTTP_OPTIONS, handleOptions);
  server.on("/update", HTTP_OPTIONS, handleOptions);

  server.on("/api/info", HTTP_GET, handleInfo);
  server.on("/api/gpio", HTTP_GET, handleGpioGet);
  server.on("/api/gpio", HTTP_POST, handleGpioPost);
  server.on("/api/logs", HTTP_GET, handleLogs);
  server.on("/update", HTTP_POST, handleUpdateDone, handleUpdateUpload);
  server.onNotFound([]() {
    sendJson(404, "{\"error\":\"Not found\"}");
  });
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  addLog("Wi-Fi connected: " + WiFi.localIP().toString());
}

void setupMdns() {
  String host = "boardroom-esp32-" + chipId().substring(8);
  host.toLowerCase();
  if (MDNS.begin(host.c_str())) {
    MDNS.addService("boardroom", "tcp", 80);
    addLog("mDNS ready: " + host + ".local");
  } else {
    addLog("mDNS start failed");
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("Boardroom ESP32 agent starting");

  for (size_t index = 0; index < BOARDROOM_GPIO_PIN_COUNT; index++) {
    pinMode(GPIO_PINS[index], OUTPUT);
    digitalWrite(GPIO_PINS[index], LOW);
  }

  connectWifi();
  setupMdns();
  setupRoutes();
  server.begin();
  addLog("HTTP server started on port 80");
}

void loop() {
  server.handleClient();
  if (shouldReboot) {
    delay(700);
    ESP.restart();
  }
}
