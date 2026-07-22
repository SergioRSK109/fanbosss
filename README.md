# FanBoss

Plateforme PWA permettant à des créateurs de contenu (Kinshasa, RDC) de
monétiser leur relation avec leurs fans via 3 types d'offres : vidéo
personnalisée, don libre, accès WhatsApp premium.

## Stack

- **Frontend** : Next.js (App Router) + Tailwind, déployé sur Vercel
- **Backend / BDD / Auth** : Supabase (Postgres + Auth + Row Level Security)
- **Stockage vidéos** : Cloudflare R2, bucket **privé** (accès uniquement via
  URL signée temporaire)
- **Paiement** : CinetPay (M-Pesa / Airtel Money / Orange Money)

## Démarrage

```bash
npm install
cp .env.example .env.local   # renseigner les clés Supabase / CinetPay / R2
npm run dev
```

### Base de données

Appliquer les migrations `supabase/migrations/*.sql` dans l'ordre sur un
projet Supabase (via le SQL editor, ou `supabase db push` avec la CLI
officielle). Elles créent le schéma, les contraintes, les triggers/fonctions
métier et activent RLS.

### Déploiement (Vercel Hobby) et cron des deadlines

Le plan Vercel Hobby (gratuit) limite les cron jobs à une exécution par
jour maximum, ce qui est trop lent pour le brief 0.3 (un fan ne doit pas
attendre 24h pour être remboursé d'une demande jamais acceptée). Il n'y a
donc pas de bloc `crons` dans `vercel.json` — la route
`/api/cron/check-deadlines` existe toujours et vérifie toujours
`Authorization: Bearer {CRON_SECRET}` exactement comme avant, mais elle
doit être appelée par un scheduler externe gratuit plutôt que par Vercel.

Une fois l'app déployée, configurer **une seule fois**, manuellement, dans
le dashboard d'un service comme [cron-job.org](https://cron-job.org) ou
EasyCron :
- URL : `https://{NEXT_PUBLIC_APP_URL}/api/cron/check-deadlines`
- Fréquence : toutes les heures
- En-tête HTTP : `Authorization: Bearer {CRON_SECRET}`

Rien dans le code n'automatise cette étape ; c'est volontairement une
configuration à faire une fois dans l'outil externe. Si le projet passe un
jour sur Vercel Pro, le bloc `crons` de `vercel.json` (voir l'historique
git) peut être réintroduit et ce scheduler externe désactivé.

## Tests

```bash
npm test          # tests applicatifs (Vitest) : HMAC CinetPay, webhook,
                   # routes de livraison signée, validation
npm run test:sql  # tests SQL de bout en bout, contre un vrai Postgres :
                   # applique les migrations puis vérifie les contraintes
                   # et le cron de deadlines (nécessite un cluster Postgres
                   # local accessible via `sudo -u postgres psql`)
```

`npm run test:sql` crée une base jetable, applique toutes les migrations, et
prouve concrètement (pas juste "en théorie") :
- qu'une offre WhatsApp ne peut jamais descendre sous 500$, même par
  UPDATE direct sur la colonne `prix`, et qu'un champ JSON `config` ne peut
  pas contourner cette règle ;
- qu'une transaction jamais acceptée par le créateur est bien remboursée
  automatiquement une fois `deadline_acceptation` dépassée, et qu'une
  transaction acceptée mais jamais livrée l'est aussi une fois
  `deadline_livraison` dépassée.

## Points de sécurité notables (voir le brief, section 0)

- `src/lib/cinetpay.ts` : vérification HMAC-SHA256 réelle du webhook
  CinetPay, fail-closed (rejet si signature absente/invalide/clé non
  configurée).
- `supabase/migrations/0001_schema.sql` : contrainte `check_whatsapp_minimum_price`
  directement sur la colonne `offres.prix`.
- `supabase/migrations/0002_functions_triggers.sql` : `deadline_acceptation`
  ET `deadline_livraison` gérées séparément par `process_transaction_deadlines()`,
  et le state machine des transactions (`accept_transaction`,
  `refuse_transaction`, `deliver_video`) vit dans des fonctions
  `SECURITY DEFINER`, pas dans des UPDATE directs exposés au client.
- `src/app/api/webhooks/cinetpay/route.ts` : jointure explicite vers
  `offres` avant toute logique conditionnelle, avec vérification
  `if (!offerType) throw`.
- `src/lib/r2.ts` + `src/app/api/transactions/[id]/video-url/route.ts` :
  bucket R2 privé, livraison uniquement via URL signée (1h), après
  vérification `fan_id = auth.uid()` et `statut = 'livree'`.

## Hors scope du MVP

App mobile native, interface admin custom (Supabase Studio suffit), API
WhatsApp Business officielle, abonnements/avis/multi-devise (prévus en
feature flags désactivés dans `parametres_plateforme`), vérification
d'identité automatisée.
