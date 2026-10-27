export const messages = {
  metadata: {
    title: "Middleware",
    description: "Middleware — entorno local (WP-01)",
  },
  home: {
    title: "Middleware",
    description: "Shell web de WP-01. Entorno local listo.",
  },
  devUi: {
    title: "Sistema de diseño",
    description:
      "Todos los componentes de firma. Cambiá el tema para verlos en claro y oscuro.",
    theme: {
      label: "Tema",
      system: "Sistema",
      light: "Claro",
      dark: "Oscuro",
    },
    sections: {
      surfaces: "Superficies",
      forms: "Formularios",
      status: "Estado",
      flow: "Flujo",
      chat: "Chat",
      brand: "Marca",
    },
    sample: {
      card: "Card sobre el fondo",
      raisedRow: "Fila elevada",
      darkPanel: "Panel oscuro",
      approval: "Aprobación requerida",
      fieldLabel: "Nombre del agente",
      fieldHint: "Se muestra en tu lista de agentes.",
      fieldErrorLabel: "Email",
      fieldError: "Ingresá un email válido.",
      pillA: "Diario",
      pillB: "Semanal",
      segmentedLabel: "Frecuencia",
      switchLabel: "Notificaciones",
      toolStep: "Buscar en la web",
      toolStepNext: "Resumir resultados",
      userBubble: "¿Podés resumir mis pendientes?",
      agentBubble: "Claro, estos son tus pendientes de hoy.",
      iconTile: "Icono",
      composerPlaceholder: "Escribí un mensaje…",
      composerInput: "Mensaje",
      composerDictate: "Dictar",
      composerSend: "Enviar",
      badges: {
        accent: "Acento",
        soft: "Suave",
        neutral: "Neutral",
        success: "Activo",
        warning: "Pendiente",
        danger: "Con error",
      },
    },
  },
  auth: {
    fields: {
      name: "Nombre",
      email: "Email",
      password: "Contraseña",
    },
    submitting: "Enviando…",
    googleDeferred:
      "El inicio de sesión con Google estará disponible cuando se configuren sus credenciales.",
    errors: {
      submit:
        "No pudimos procesar tu solicitud. Revisá los datos e intentá de nuevo.",
      network: "No pudimos conectarnos. Probá de nuevo en unos minutos.",
    },
    login: {
      title: "Iniciá sesión",
      description: "Ingresá a tu workspace.",
      submit: "Ingresar",
    },
    register: {
      title: "Creá tu cuenta",
      description: "Vamos a crear tu workspace personal.",
      submit: "Crear cuenta",
    },
    forgotPassword: {
      title: "Recuperá tu contraseña",
      description: "Te vamos a enviar instrucciones para restablecerla.",
      submit: "Enviar instrucciones",
      sent: "Si existe una cuenta con ese email, te enviamos las instrucciones.",
    },
  },
} as const;
