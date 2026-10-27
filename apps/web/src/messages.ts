export const messages = {
  metadata: {
    title: "Middleware",
    description: "Middleware — entorno local (WP-01)",
  },
  home: {
    title: "Middleware",
    description: "Shell web de WP-01. Entorno local listo.",
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
