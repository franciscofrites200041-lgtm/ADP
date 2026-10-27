export const messages = {
  metadata: {
    title: "Middleware",
    description: "Un lugar para tus modelos y lo que hacen por vos.",
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
  appShell: {
    navigationLabel: "Navegación principal",
    brand: "Middleware",
    openNavigation: "Abrir navegación",
    closeNavigation: "Cerrar navegación",
    workspace: "Tu workspace",
    workspaceInitials: "TU",
    navigation: {
      home: "Inicio",
      agents: "Agentes",
      groups: "Grupos",
      chats: "Chats",
      providers: "Proveedores",
      tools: "Herramientas",
      schedules: "Tareas programadas",
      approvals: "Aprobaciones",
      runs: "Ejecuciones",
      usage: "Uso",
      settings: "Ajustes",
    },
    theme: {
      label: "Tema",
      system: "Sistema",
      light: "Claro",
      dark: "Oscuro",
    },
  },
  home: {
    greeting: "Hola",
    workspaceName: "tu workspace",
    title: "/tus keys\n/tus agentes",
    description: "Un lugar para todos tus modelos y lo que hacen por vos.",
    createTitle: "Empezá por acá",
    createAgent: "Nuevo agente",
    createSchedule: "Nueva tarea programada",
    createConnection: "Nueva conexión",
    providers: {
      title: "Tus proveedores",
      emptyTitle: "Todavía no conectaste ningún proveedor",
      emptyDescription:
        "Cuando cargues una key, tus modelos van a aparecer acá.",
      action: "Conectar un proveedor",
    },
    flow: {
      title: "Tu primer flujo",
      description:
        "Creá un agente y conectalo a una tarea para automatizar tu rutina.",
      action: "Crear un agente",
    },
    usage: {
      title: "Uso del mes",
      emptyTitle: "Todavía no hay uso para mostrar",
      description: "Las ejecuciones y sus costos se van a resumir acá.",
    },
    ask: {
      placeholder: "Preguntale a un agente…",
      label: "Preguntale a un agente",
      dictate: "Dictar",
      send: "Enviar",
    },
  },
  emptyPages: {
    agents: {
      title: "Agentes",
      emptyTitle: "Todavía no creaste agentes",
      description:
        "Creá tu primer agente para darle instrucciones, modelo y herramientas.",
      action: "Crear agente",
    },
    groups: {
      title: "Grupos",
      emptyTitle: "Todavía no creaste grupos",
      description:
        "Cuando tengas agentes, podés reunirlos para trabajar en equipo.",
      action: "Crear grupo",
    },
    chats: {
      title: "Chats",
      emptyTitle: "Todavía no hay conversaciones",
      description: "Elegí un agente para empezar una conversación.",
      action: "Ver agentes",
    },
    providers: {
      title: "Proveedores",
      emptyTitle: "Todavía no tenés proveedores",
      description: "Conectá una key para usar los modelos de tu proveedor.",
      action: "Conectar proveedor",
    },
    tools: {
      title: "Herramientas",
      emptyTitle: "Todavía no conectaste herramientas",
      description:
        "Sumá búsqueda, HTTP o un servidor MCP para ampliar tus agentes.",
      action: "Agregar herramienta",
    },
    schedules: {
      title: "Tareas programadas",
      emptyTitle: "Todavía no programaste tareas",
      description:
        "Automatizá una ejecución para que corra cuando la necesites.",
      action: "Crear tarea",
    },
    approvals: {
      title: "Aprobaciones",
      emptyTitle: "No tenés aprobaciones pendientes",
      description:
        "Las acciones que necesiten tu confirmación van a aparecer acá.",
      action: "Ver ejecuciones",
    },
    runs: {
      title: "Ejecuciones",
      emptyTitle: "Todavía no hay ejecuciones",
      description:
        "Cuando uses un agente, vas a poder seguir su actividad desde acá.",
      action: "Ver agentes",
    },
    usage: {
      title: "Uso",
      emptyTitle: "Todavía no hay uso para mostrar",
      description:
        "Los costos y tokens aparecen cuando corras tu primer agente.",
      action: "Ver agentes",
    },
    settings: {
      title: "Ajustes",
      emptyTitle: "Configurá tu workspace",
      description:
        "Muy pronto vas a poder administrar tu perfil y preferencias desde acá.",
      action: "Volver al inicio",
    },
  },
} as const;
