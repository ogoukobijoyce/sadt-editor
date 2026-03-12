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
| Renommer | Double-cliquez sur le rectangle, saisissez le nouveau nom, appuyez sur **Entrée** |
| Redimensionner | Sélectionnez le rectangle → faites glisser l'un des 4 coins bleus |
| Supprimer | Sélectionnez → cliquez **Supprimer** ou appuyez sur la touche **Suppr** |

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

#### Étiqueter une flèche
Double-cliquez sur la flèche, saisissez l'étiquette, appuyez sur **Entrée**.

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
| `Suppr` / `Backspace` | Supprimer l'élément sélectionné |
| `Échap` | Annuler / Revenir en mode Sélection |
| `Ctrl + S` | Sauvegarder en JSON |
| Double-clic | Renommer un rectangle ou une flèche |

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
