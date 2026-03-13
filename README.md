# SADT Editor

Éditeur de diagrammes **SADT** (Structured Analysis and Design Technique) / **Actigrammes** — application web simple fonctionnant entièrement dans le navigateur, sans installation ni serveur.

## Démarrage rapide

1. Clonez ou téléchargez ce dépôt.
2. Ouvrez le fichier `index.html` dans un navigateur moderne (Chrome, Firefox, Edge, Safari).
3. C'est tout ! Aucune installation, aucun serveur nécessaire.

---

## Fonctionnalités

### Rectangles (Fonctions / Activités)
| Action | Comment faire |
|--------|--------------|
| Ajouter un rectangle | Cliquez sur **Rectangle** dans la barre d'outils, puis cliquez sur le canvas |
| Déplacer un rectangle | Mode **Sélection** → glissez le rectangle |
| Renommer | Sélectionnez le rectangle → cliquez **✏️ Nommer** (ou `N`), ou double-cliquez dessus |
| Redimensionner | Sélectionnez le rectangle → faites glisser l'un des 4 coins bleus |
| Supprimer | Sélectionnez → cliquez **Supprimer** ou appuyez sur la touche **Suppr** |

### Rectangles imbriqués (Décomposition hiérarchique SADT)

Il est possible de **placer des rectangles à l'intérieur d'autres rectangles** pour représenter la décomposition hiérarchique (A0 contient A1, A2, A3…).

| Action | Comment faire |
|--------|--------------|
| Ajouter un sous-rectangle | Sélectionnez un rectangle parent → cliquez **Sous-rect** dans la barre d'outils |
| Imbriquer par glisser-déposer | Glissez un rectangle et déposez-le à l'intérieur d'un autre rectangle |
| Désimbriquer | Glissez le rectangle enfant hors de son parent et déposez-le dans le vide |
| Déplacer le parent | Glissez le rectangle parent — tous ses enfants se déplacent avec lui |
| Agrandissement automatique | Quand un enfant est déplacé vers le bord, le parent s'agrandit automatiquement |

**Repères visuels des rectangles parents :**
- Fond légèrement bleuté
- Bordure plus épaisse (bleue marine)
- Ligne de séparation sous l'étiquette du parent, laissant la zone du bas aux sous-fonctions

### Flèches (Flux)

#### Flèche de connexion (entre deux rectangles)
1. Cliquez sur **Flèche** dans la barre d'outils.
2. Cliquez sur le bord d'un premier rectangle (la flèche se «snape» automatiquement sur le bord le plus proche).
3. Cliquez sur le bord d'un second rectangle pour terminer la connexion.

> **Astuce :** Vous pouvez cliquer **n'importe où** sur le bord d'un rectangle — plusieurs flèches peuvent partir du même côté.

#### Flèche libre (Entrée / Sortie / Contrôle / Mécanisme)
1. Choisissez le type de flèche dans le menu déroulant (🔵 Entrée, 🟢 Sortie, 🔴 Contrôle, 🟠 Mécanisme).
2. Cliquez sur **Flèche libre** dans la barre d'outils.
3. Cliquez pour démarrer la flèche (peut commencer dans le vide ou sur un bord de rectangle).
4. Cliquez à nouveau pour terminer la flèche.

#### Code couleur des flèches
| Type | Couleur | Position SADT habituelle |
|------|---------|--------------------------|
| Entrée (Input) | 🔵 Bleu | Côté gauche |
| Sortie (Output) | 🟢 Vert | Côté droit |
| Contrôle (Control) | 🔴 Rouge | Côté supérieur |
| Mécanisme (Mechanism) | 🟠 Orange | Côté inférieur |
| Connexion | ⬛ Gris | Rect → Rect |

#### Points de virage sur les flèches
- **Double-cliquez sur un segment de flèche** pour ajouter un point de virage (waypoint) à cet endroit.
- **Glissez le point de virage** (cercle blanc) pour remodeler la flèche.
- **Double-cliquez sur un point de virage** pour le supprimer.
- **Clic droit sur un point de virage** pour le supprimer également.

#### Étiquettes des flèches
- **Cliquez sur la flèche** pour la sélectionner, puis cliquez sur le bouton **✏️ Nommer** dans la barre d'outils (ou appuyez sur `N`).
- Double-cliquez sur la flèche, saisissez l'étiquette, appuyez sur **Entrée**.
- L'étiquette s'affiche **à côté de la flèche** (décalée perpendiculairement à sa direction) dans un encadré coloré.
- Si la flèche n'a pas d'étiquette, rien n'est affiché.

### Ajustement de la vue

- **🔍 Ajuster vue** — repositionne et redimensionne le diagramme pour qu'il soit entièrement visible dans le canvas.
- Raccourci clavier : `V`
- Utile quand des éléments sont trop petits ou placés en dehors de la zone visible.

### Sauvegarde et chargement
- **💾 Sauvegarder** — exporte le diagramme complet en fichier JSON.
- **📂 Charger** — importe un fichier JSON précédemment sauvegardé.
- **🖼 PNG** — exporte le canvas en image PNG (sans les poignées de sélection).

---

## Raccourcis clavier

| Touche | Action |
|--------|--------|
| `S` | Mode Sélection |
| `R` | Mode Ajouter un rectangle |
| `A` | Mode Flèche connexion |
| `F` | Mode Flèche libre |
| `N` | Nommer / renommer l'élément sélectionné |
| `V` | Ajuster la vue au contenu |
| `Suppr` / `Backspace` | Supprimer l'élément sélectionné |
| `Échap` | Annuler / Revenir en mode Sélection |
| `Ctrl + S` | Sauvegarder en JSON |
| Double-clic rectangle | Renommer le rectangle |
| Double-clic flèche (sur segment) | Ajouter un point de virage |
| Double-clic flèche (près étiquette) | Renommer la flèche |
| Double-clic waypoint | Supprimer le point de virage |
| Clic droit waypoint | Supprimer le point de virage |

---

## Structure des fichiers

```
index.html   — Page principale (structure HTML)
style.css    — Styles de l'application
app.js       — Logique complète (canvas, drag & drop, flèches, connexions)
README.md    — Cette documentation
```

## Contraintes techniques respectées

- ✅ Pas de framework (pas de React, Vue, Angular)
- ✅ Pas de dépendances externes (pas de npm, pas de CDN)
- ✅ HTML5 Canvas pour le rendu graphique
- ✅ JavaScript vanilla uniquement
- ✅ Fonctionne en ouvrant directement `index.html`
- ✅ Interface entièrement en français

---

## Les 4 types de flux SADT

```
          CONTRÔLES (rouge)
         Normes, règles, savoir-faire
                   ↓
    ┌──────────────────────────────────┐
    │                                  │
→   │         Activité / Fonction      │  →
(Entrées)                            (Sorties)
(bleu)  │                              │  (vert)
    └──────────────────────────────────┘
                   ↑
         MÉCANISMES (orange)
         Ressources, outils, personnel
```
