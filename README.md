# Ant Wars

A solo, touch-friendly strategy game on a picnic battlefield. Command the Moss colony against Ember. Bring home 40 crumbs first, or lead when the 90-second round ends.

## Playing

Select one of two scent trails, then tap a food source or draw a route from the Moss nest. Send ants to the Ember nest to steal crumbs, or to open ground to post guards. A new order applies to the next party leaving home. Ants already in the field finish their trip.

Each colony shares a small contextual bandit model. Individual trips teach it whether to send a lone worker or an escort, using rewards from food delivered, interceptions, time spent, and workers committed. Ember also uses these outcomes to choose its destinations under quiet conditions and under raid pressure. Both colonies remember completed trips on this device. The Colony Lab shows what they have learned and can share a frozen copy of your colony as a challenge link.

## Running locally

Serve the repository root with a static HTTP server, for example `python3 -m http.server 8000`, then visit `http://localhost:8000`. Run the simulation checks with `node --test`.

The GitHub Pages workflow tests the simulation and deploys the browser files on pushes to `main`. All game logic runs in the browser. Fonts and artwork ship with the game.
