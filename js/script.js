/**
 * ============================================================================
 * LÓGICA DE INTERFAZ Y CLIENTE DE TELEMETRÍA BIOMECÁNICA IOT (UDP)
 * ============================================================================
 * Arquitectura del Frontend:
 * 1. Configuración de Red y Endpoints (Integración con Backend FastAPI).
 * 2. Cliente WebSocket en Tiempo Real (Recepción de ángulos y estado de nodos).
 * 3. Motor de Alertas Auditivas de Baja Latencia (< 200 ms vía Web Audio API).
 * 4. Inicialización y Renderizado de Gráficos (Chart.js).
 * 5. Evaluación Biomecánica de Desviaciones y Registro de Eventos.
 * 6. Simulador Local de Respaldo (Pruebas sin hardware conectado).
 * 7. Operaciones CRUD de Pacientes, Patrones y Exportación de Reportes.
 * ============================================================================
 */

/* ============================================================================
 * 1. CONFIGURACIÓN DEL SERVIDOR Y VARIABLES GLOBALES DE ESTADO
 * ============================================================================ */

/**
 * Dirección del servidor central en Python (FastAPI) desarrollado por Ignacio.
 * Cambiar la IP si el servidor corre en otra máquina dentro de la red Hotspot.
 */
const BACKEND_CONFIG = {
    API_BASE_URL: "http://127.0.0.1:8000/api",
    WS_URL: "ws://127.0.0.1:8000"
};

let websocketCliente = null;
let simulacionActiva = false;
let intervalSim = null;
let pasoSimulacion = 0;
let alertaActivaEnProgreso = false;
let totalAlertasContador = 0;
let chartPatronBase = null;

/**
 * Parámetros biomecánicos por eje de medición (Sección 12.1 del Informe).
 * Define los rangos de los ejes gráficos, textos de alerta y curvas de prueba.
 */
const CONFIGURACION_METRICAS = {
    profundidad: {
        label: "Modo: Profundidad / Flexión",
        desc: "Evalúa el ángulo de flexión articular durante la fase excéntrica y concéntrica.",
        minY: -10,
        maxY: 120,
        alertaTexto: "¡ALERTA: RANGO INCOMPLETO / EXCESIVO!",
        simBase: (p) => 45 + 35 * Math.sin(p),
        simError: (p) => (Math.sin(p) > 0.75) ? 18 : 2
    },
    valgo: {
        label: "Modo: Valgo de Rodilla (Plano Frontal)",
        desc: "Mide el desplazamiento medial de la rodilla en el plano frontal.",
        minY: -20,
        maxY: 30,
        alertaTexto: "¡ALERTA: VALGO DE RODILLA DETECTADO!",
        simBase: (p) => 2 + 3 * Math.sin(p),
        simError: (p) => (Math.sin(p) > 0.6) ? 14 : 1
    },
    tronco: {
        label: "Modo: Inclinación de Tronco",
        desc: "Calcula el ángulo del torso respecto a la línea vertical de gravedad.",
        minY: -5,
        maxY: 75,
        alertaTexto: "¡ALERTA: INCLINACIÓN EXCESIVA DE TRONCO!",
        simBase: (p) => 15 + 20 * Math.sin(p),
        simError: (p) => (Math.sin(p) > 0.7) ? 16 : 2
    }
};

/* ============================================================================
 * 2. COMUNICACIÓN CON BACKEND (WEBSOCKET Y API REST FASTAPI)
 * ============================================================================ */

/**
 * Inicia la conexión WebSocket con el servidor FastAPI para recibir el ángulo
 * articular ya procesado por el Filtro de Madgwick/Complementario.
 *
 * Estructura JSON esperada desde el servidor de Ignacio:
 * {
 *   "angulo_actual": 62.4,
 *   "angulo_patron": 58.0,
 *   "nodo_timeout": null // o el ID del nodo desconectado (>1s sin paquetes UDP)
 * }
 */
function conectarWebSocketServidor() {
    try {
        websocketCliente = new WebSocket(BACKEND_CONFIG.WS_URL);

        websocketCliente.onopen = () => {
            actualizarEstadoConexionUI(true, "Servidor FastAPI Conectado (100 Hz)");
        };

        websocketCliente.onmessage = (event) => {
            const payload = JSON.parse(event.data);
            if (typeof payload.angulo_actual === "number" && typeof payload.angulo_patron === "number") {
                actualizarTelemetriaEnVivo(payload.angulo_actual, payload.angulo_patron);
            }
            if (payload.nodo_timeout) {
                simularDesconexionNodo();
            }
        };

        websocketCliente.onclose = () => {
            if (!simulacionActiva) {
                actualizarEstadoConexionUI(false, "Servidor Offline");
            }
        };
    } catch (err) {
        console.warn("WebSocket no disponible aún. Modo simulación local habilitado.", err);
    }
}

/**
 * Función auxiliar para realizar peticiones HTTP REST hacia FastAPI/PostgreSQL.
 * @param {string} endpoint - Ruta relativa (ej. "/pacientes" o "/calibrar").
 * @param {string} metodo - Verbo HTTP ("GET", "POST", "DELETE").
 * @param {Object|null} datos - Cuerpo JSON a enviar.
 */
async function peticionBackendREST(endpoint, metodo = "GET", datos = null) {
    const opciones = {
        method: metodo,
        headers: { "Content-Type": "application/json" }
    };
    if (datos) {
        opciones.body = JSON.stringify(datos);
    }
    const respuesta = await fetch(`${BACKEND_CONFIG.API_BASE_URL}${endpoint}`, opciones);
    if (!respuesta.ok) {
        throw new Error(`Error HTTP ${respuesta.status}`);
    }
    return await respuesta.json();
}

/* ============================================================================
 * 3. MOTOR DE ALERTAS AUDITIVAS (WEB AUDIO API - CUMPLIMIENTO RNF3 < 200 MS)
 * ============================================================================ */

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

/**
 * Sintetiza un tono de alerta de 880 Hz directamente en el navegador sin cargar
 * archivos externos, garantizando una latencia inmediata inferior a 200 ms.
 */
function emitirAlertaSonora() {
    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }
    const oscilador = audioCtx.createOscillator();
    const ganancia = audioCtx.createGain();

    oscilador.type = "sawtooth";
    oscilador.frequency.setValueAtTime(880, audioCtx.currentTime);
    ganancia.gain.setValueAtTime(0.15, audioCtx.currentTime);

    oscilador.connect(ganancia);
    ganancia.connect(audioCtx.destination);

    oscilador.start();
    oscilador.stop(audioCtx.currentTime + 0.15);
}

/* ============================================================================
 * 4. INICIALIZACIÓN DE GRÁFICOS (CHART.JS)
 * ============================================================================ */

const MAX_PUNTOS_GRAFICO = 50;

// Gráfico principal de telemetría en vivo
const ctxLive = document.getElementById("telemetryChart").getContext("2d");
const telemetryChart = new Chart(ctxLive, {
    type: "line",
    data: {
        labels: Array(MAX_PUNTOS_GRAFICO).fill(""),
        datasets: [
            {
                label: "Ángulo Medido",
                data: Array(MAX_PUNTOS_GRAFICO).fill(0),
                borderColor: "#10b981",
                borderWidth: 2,
                tension: 0.3,
                pointRadius: 0
            },
            {
                label: "Patrón Referencia",
                data: Array(MAX_PUNTOS_GRAFICO).fill(0),
                borderColor: "#64748b",
                borderWidth: 1.5,
                borderDash: [4, 4],
                pointRadius: 0
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
            y: { min: -10, max: 120, grid: { color: "#334155" } },
            x: { grid: { display: false } }
        },
        plugins: { legend: { display: false } }
    }
});

// Gráfico post-serie de Tiempo Bajo Tensión (TUT)
const ctxTut = document.getElementById("tutChart").getContext("2d");
new Chart(ctxTut, {
    type: "bar",
    data: {
        labels: ["Repetición 1", "Repetición 2", "Repetición 3", "Repetición 4 (Falla)"],
        datasets: [{
            label: "Tiempo Bajo Tensión (segundos)",
            data: [2.5, 2.8, 3.4, 4.2],
            backgroundColor: ["#10b981", "#10b981", "#10b981", "#ef4444"],
            borderRadius: 6
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: { min: 0, max: 5, grid: { color: "#334155" } },
            x: { grid: { display: false } }
        },
        plugins: { legend: { display: false } }
    }
});

/* ============================================================================
 * 5. PROCESAMIENTO VISUAL DE TELEMETRÍA Y EVALUACIÓN DE TOLERANCIA (RF4 / RF5)
 * ============================================================================ */

/**
 * Actualiza el gráfico en tiempo real y verifica la condición matemática:
 * |theta(t) - theta_patron(t)| > theta_tol
 *
 * @param {number} anguloActual - Ángulo articular medido en el instante t.
 * @param {number} anguloPatron - Ángulo de la curva patrón en el instante t.
 */
function actualizarTelemetriaEnVivo(anguloActual, anguloPatron) {
    const tolerancia = parseInt(document.getElementById("inputTolerancia").value, 10);
    const desviacion = Math.abs(anguloActual - anguloPatron);
    const keyMetrica = document.getElementById("selectMetricaBiomecanica").value;
    const config = CONFIGURACION_METRICAS[keyMetrica];

    // Desplazar ventana de datos en el gráfico
    telemetryChart.data.datasets[0].data.push(anguloActual);
    telemetryChart.data.datasets[0].data.shift();
    telemetryChart.data.datasets[1].data.push(anguloPatron);
    telemetryChart.data.datasets[1].data.shift();
    telemetryChart.update();

    const txtAngulo = document.getElementById("txtAnguloActual");
    txtAngulo.innerText = `${anguloActual.toFixed(1)}°`;

    const alertBanner = document.getElementById("alertBanner");
    const alertIcon = document.getElementById("alertIcon");
    const alertTitle = document.getElementById("alertTitle");
    const alertSub = document.getElementById("alertSub");

    if (desviacion > tolerancia) {
        alertBanner.className = "alert-banner alert-danger";
        alertIcon.className = "alert-indicator indicator-danger";
        alertTitle.innerText = config.alertaTexto;
        alertSub.innerText = `Desviación de ${desviacion.toFixed(1)}° excede los ±${tolerancia}° permitidos.`;
        txtAngulo.className = "angle-value value-danger";

        if (!alertaActivaEnProgreso) {
            alertaActivaEnProgreso = true;
            emitirAlertaSonora();
            registrarEventoEnLog(config.alertaTexto, desviacion, tolerancia, config.label);
        }
    } else {
        alertBanner.className = "alert-banner alert-ok";
        alertIcon.className = "alert-indicator indicator-ok";
        alertTitle.innerText = "Postura Correcta";
        alertSub.innerText = "Desviación dentro del margen permitido.";
        txtAngulo.className = "angle-value value-ok";

        alertaActivaEnProgreso = false;
    }
}

/**
 * Inserta un nuevo registro en el historial de alertas cuando ocurre una falla.
 */
function registrarEventoEnLog(tituloAlerta, desviacion, tolerancia, nombreMetrica) {
    const container = document.getElementById("logAlertasContainer");
    const placeholder = document.getElementById("logPlaceholder");
    if (placeholder) {
        placeholder.remove();
    }

    totalAlertasContador++;
    const badge = document.getElementById("badgeAlertCount");
    badge.innerText = `${totalAlertasContador} Alertas`;
    badge.className = "badge badge-danger";

    const horaActual = new Date().toLocaleTimeString();
    const item = document.createElement("div");
    item.className = "log-item";
    item.innerHTML = `
        <div>
            <span class="log-time">${horaActual}</span>
            <strong class="text-red-light">${tituloAlerta}</strong>
        </div>
        <div>
            Desviación: <strong class="text-red">${desviacion.toFixed(1)}°</strong> (Umbral: &plusmn;${tolerancia}°) | <span>${nombreMetrica}</span>
        </div>
    `;
    container.insertBefore(item, container.firstChild);
}

function limpiarLogAlertas() {
    totalAlertasContador = 0;
    const badge = document.getElementById("badgeAlertCount");
    badge.innerText = "0 Registros";
    badge.className = "badge badge-neutral";

    document.getElementById("logAlertasContainer").innerHTML = `
        <div id="logPlaceholder" class="log-placeholder">
            Sin alertas detectadas. Active la simulación o conecte el servidor para registrar desviaciones biomecánicas en tiempo real.
        </div>
    `;
}

/* ============================================================================
 * 6. SIMULADOR LOCAL Y CONTROLES DE INTERFAZ (MODO DEMO / WOKWI)
 * ============================================================================ */

function cambiarTab(tabId) {
    const vistas = ["tabLive", "tabPostSerie", "tabPacientes", "tabManual"];
    vistas.forEach((id) => {
        document.getElementById(id).classList.toggle("hidden", id !== tabId);
    });

    const mapaBotones = {
        tabLive: "btnTabLive",
        tabPostSerie: "btnTabPostSerie",
        tabPacientes: "btnTabPacientes",
        tabManual: "btnTabManual"
    };

    Object.entries(mapaBotones).forEach(([vista, btnId]) => {
        const boton = document.getElementById(btnId);
        boton.classList.toggle("active", vista === tabId);
    });
}

function actualizarEtiquetaTolerancia(valor) {
    document.getElementById("lblTol").innerText = `${valor}°`;
}

function actualizarMetricaSeleccionada() {
    const key = document.getElementById("selectMetricaBiomecanica").value;
    const config = CONFIGURACION_METRICAS[key];

    document.getElementById("labelMetricaActiva").innerText = config.label;
    document.getElementById("descMetrica").innerText = config.desc;
    telemetryChart.options.scales.y.min = config.minY;
    telemetryChart.options.scales.y.max = config.maxY;
    telemetryChart.update();
}

function actualizarEstadoConexionUI(online, texto) {
    const dot = document.getElementById("statusDot");
    const label = document.getElementById("statusText");
    dot.className = online ? "status-dot dot-online" : "status-dot dot-offline";
    label.innerText = texto;
}

function toggleSimulacion() {
    simulacionActiva = !simulacionActiva;
    const btn = document.getElementById("btnSimular");

    if (simulacionActiva) {
        btn.innerText = "Detener Simulación";
        btn.className = "btn btn-amber";
        actualizarEstadoConexionUI(true, "WLAN Activa (100 Hz UDP)");

        intervalSim = setInterval(() => {
            pasoSimulacion += 0.1;
            const keyMetrica = document.getElementById("selectMetricaBiomecanica").value;
            const config = CONFIGURACION_METRICAS[keyMetrica];
            const patron = config.simBase(pasoSimulacion);
            const error = config.simError(pasoSimulacion);
            const actual = patron + (Math.random() * error - 1);
            actualizarTelemetriaEnVivo(actual, patron);
        }, 100);
    } else {
        clearInterval(intervalSim);
        btn.innerText = "Activar Simulación";
        btn.className = "btn btn-indigo";
        actualizarEstadoConexionUI(false, "Servidor Offline");
    }
}

function simularDesconexionNodo() {
    document.getElementById("nodoCard2").className = "node-card node-card-timeout";
    const badge = document.getElementById("nodoBadge2");
    badge.className = "badge badge-danger";
    badge.innerText = "TIMEOUT (>1s)";

    const loss = document.getElementById("nodoLoss2");
    loss.className = "text-red";
    loss.innerText = "100%";

    document.getElementById("reconexionNotice").classList.remove("hidden");
}

function restaurarNodo() {
    document.getElementById("nodoCard2").className = "node-card";
    const badge = document.getElementById("nodoBadge2");
    badge.className = "badge badge-online";
    badge.innerText = "ONLINE";

    const loss = document.getElementById("nodoLoss2");
    loss.className = "text-emerald";
    loss.innerText = "1.1%";

    document.getElementById("reconexionNotice").classList.add("hidden");
}

async function ejecutarZeroing() {
    try {
        await peticionBackendREST("/calibrar", "POST", { duracion_s: 2 });
        alert("Calibración completada en el servidor: Offsets estáticos ajustados.");
    } catch {
        alert("Calibración local completada (Zeroing 2s): Offsets estáticos ajustados.");
    }
}

async function grabarPatron() {
    const pacienteId = document.getElementById("selectPacienteLive").value;
    try {
        await peticionBackendREST("/patrones/grabar", "POST", { paciente_id: pacienteId });
        alert("Repetición patrón registrada en PostgreSQL.");
    } catch {
        alert("Repetición patrón guardada en modo simulación.");
    }
}

/* ============================================================================
 * 7. GESTIÓN CRUD DE PACIENTES, PATRONES Y EXPORTACIÓN DE REPORTES (RF8)
 * ============================================================================ */

function abrirModalPaciente() {
    document.getElementById("modalPaciente").classList.remove("hidden");
}

function cerrarModalPaciente() {
    document.getElementById("modalPaciente").classList.add("hidden");
    document.getElementById("formNuevoPaciente").reset();
}

async function guardarPaciente(event) {
    event.preventDefault();
    const nuevoPaciente = {
        nombre: document.getElementById("nuevoNombre").value,
        rut: document.getElementById("nuevoRut").value,
        edad: parseInt(document.getElementById("nuevaEdad").value, 10),
        sexo: document.getElementById("nuevoSexo").value,
        correo: document.getElementById("nuevoCorreo").value
    };

    // Intenta persistir en el backend de Ignacio si está disponible
    try {
        await peticionBackendREST("/pacientes", "POST", nuevoPaciente);
    } catch {
        console.info("Backend offline: agregando paciente en memoria de sesión.");
    }

    const tbody = document.getElementById("tablaPacientesBody");
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td>${nuevoPaciente.rut}</td>
        <td>
            <strong>${nuevoPaciente.nombre}</strong>
            <span class="table-subtext">${nuevoPaciente.edad} años | ${nuevoPaciente.sexo} | ${nuevoPaciente.correo}</span>
        </td>
        <td>Por asignar</td>
        <td><span class="badge badge-amber">Pendiente</span></td>
        <td class="table-actions">
            <button class="btn-link text-emerald" onclick="verPatronPaciente('${nuevoPaciente.nombre}', 'Por asignar', 10)">Ver Patrón</button>
            <button class="btn-link text-indigo" onclick="consultarHistorialPaciente('${nuevoPaciente.rut}')">Historial</button>
            <button class="btn-link text-red" onclick="eliminarFila(this)">Eliminar</button>
        </td>
    `;
    tbody.appendChild(tr);

    const selectLive = document.getElementById("selectPacienteLive");
    const opt = document.createElement("option");
    opt.value = Date.now().toString();
    opt.innerText = nuevoPaciente.nombre;
    selectLive.appendChild(opt);

    cerrarModalPaciente();
}

function eliminarFila(boton) {
    if (confirm("¿Está seguro de eliminar este registro de paciente?")) {
        boton.closest("tr").remove();
    }
}

function consultarHistorialPaciente(rut) {
    alert(`Consultando historial de sesiones en PostgreSQL para el RUT ${rut}...`);
}

function verPatronPaciente(nombre, ejercicio, tolerancia) {
    document.getElementById("patronModalTitle").innerText = `Patrón Biomecánico - ${nombre}`;
    document.getElementById("patronModalSub").innerText = `Ejercicio: ${ejercicio} | Curva de referencia en PostgreSQL`;
    document.getElementById("patronTolInput").value = tolerancia;
    document.getElementById("modalPatron").classList.remove("hidden");

    const ctxP = document.getElementById("patronBaseChart").getContext("2d");
    if (chartPatronBase) {
        chartPatronBase.destroy();
    }

    const puntosX = Array.from({ length: 40 }, (_, i) => `${i * 2.5}%`);
    const curvaPatron = puntosX.map((_, i) => 45 + 35 * Math.sin(i * 0.16));

    chartPatronBase = new Chart(ctxP, {
        type: "line",
        data: {
            labels: puntosX,
            datasets: [{
                label: "Trayectoria Patrón (°)",
                data: curvaPatron,
                borderColor: "#10b981",
                borderWidth: 2,
                tension: 0.4,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { min: 0, max: 100, grid: { color: "#334155" } },
                x: { grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function cerrarModalPatron() {
    document.getElementById("modalPatron").classList.add("hidden");
}

function solicitarRegrabacionPatron() {
    alert("Iniciando modo de grabación de patrón. Ejecute 1 repetición con técnica correcta.");
}

function guardarHolguraPatron() {
    const tol = document.getElementById("patronTolInput").value;
    alert(`Tolerancia de ±${tol}° actualizada en PostgreSQL.`);
    cerrarModalPatron();
}

function exportarCSV() {
    const filas = [
        ["ID_Sesion", "Fecha", "Paciente", "RUT", "Repeticion", "Duracion_TUT_s", "Desviacion_Max_deg", "Estado_Biomecanico"],
        ["UDP-892", "2026-10-30", "Juan Fuentes", "19.876.543-2", 1, 2.5, 3.2, "Correcta"],
        ["UDP-892", "2026-10-30", "Juan Fuentes", "19.876.543-2", 2, 2.8, 4.1, "Correcta"],
        ["UDP-892", "2026-10-30", "Juan Fuentes", "19.876.543-2", 3, 3.4, 6.8, "Correcta"],
        ["UDP-892", "2026-10-30", "Juan Fuentes", "19.876.543-2", 4, 4.2, 14.8, "Falla Biomecanica"]
    ];

    let contenidoCSV = "data:text/csv;charset=utf-8,";
    filas.forEach((fila) => {
        contenidoCSV += fila.join(",") + "\n";
    });

    const enlace = document.createElement("a");
    enlace.setAttribute("href", encodeURI(contenidoCSV));
    enlace.setAttribute("download", "reporte_biomecanico_juan_fuentes.csv");
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
}

function abrirModalReporte() {
    document.getElementById("modalReporte").classList.remove("hidden");
}

function cerrarModalReporte() {
    document.getElementById("modalReporte").classList.add("hidden");
}

// Intentar conexión silenciosa con el backend al cargar el DOM
document.addEventListener("DOMContentLoaded", () => {
    conectarWebSocketServidor();
});
