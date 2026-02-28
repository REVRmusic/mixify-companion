<div align="center">
  <h1>🎧 Mixify Companion</h1>
  <p><strong>L'application de bureau officielle pour synchroniser Serato DJ Pro avec Mixify.fr en temps réel.</strong></p>

  <img src="https://img.shields.io/badge/Tauri-FFC131?style=for-the-badge&logo=Tauri&logoColor=white" alt="Tauri" />
  <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
</div>

<br />

## 📖 À propos du projet

**Mixify Companion** est une application bureau légère et performante conçue pour les DJs utilisant [Mixify.fr](https://mixify.fr). 
Elle tourne en arrière-plan pendant vos sets, détecte automatiquement les morceaux joués sur **Serato DJ Pro**, et met à jour votre événement Mixify en temps réel pour interagir avec votre public.

### ✨ Fonctionnalités clés
- **🔐 Authentification sécurisée :** Connectez-vous avec vos identifiants Mixify (via Supabase Auth).
- **📡 Détection Temps Réel :** Scan direct et instantané des fichiers `.log` locaux de Serato.
- **⚡ Ultra-léger :** Propulsé par Tauri, le binaire consomme un minimum de RAM et de CPU pour ne jamais ralentir votre logiciel de mix.
- **🔄 Synchronisation Cloud :** Envoi automatique des informations (Titre, Artiste) vers l'Edge Function Supabase de Mixify.
- **🎯 Smart Event Selection :** Détecte vos événements actifs ou en attente et bloque intelligemment les événements en mode Spotify.

---

## 🛠️ Architecture Technique

L'application est divisée en deux couches pour garantir des performances optimales (idéal pour les puces Apple Silicon) :
1. **Moteur Rust (Backend local) :** Un algorithme ultra-rapide qui surveille les dossiers système système `~/Music/_Serato_/Logs` pour extraire instantanément les métadonnées audio.
2. **Interface React/TypeScript (Frontend) :** Une UI moderne et réactive qui gère la communication HTTP authentifiée avec l'API REST de Mixify (Supabase).

---

## 🚀 Installation & Développement

### Prérequis
- [Node.js](https://nodejs.org/) (v18 ou supérieur)
- [Rust](https://www.rust-lang.org/) (`cargo`)
- Serato DJ Pro installé sur la machine

### Lancement en mode développement

1. Clonez le dépôt :
   ```bash
   git clone [https://github.com/REVRmusic/mixify-companion](https://github.com/REVRmusic/mixify-companion)
   cd mixify-companion