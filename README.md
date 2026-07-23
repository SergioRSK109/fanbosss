# FanBoss

Plateforme PWA permettant à n'importe quel utilisateur de monétiser sa
relation avec ses fans, via des offres : vidéo personnalisée, mention
(shoutout), don libre, accès WhatsApp premium, contenu à débloquer, accès
à un live privé. N'importe qui peut aussi bien recevoir des paiements que
payer quelqu'un d'autre — il n'y a pas de distinction fan/créateur (brief
v3 point 1).

## Stack

- **Frontend** : Next.js (App Router) + Tailwind, déployé sur Vercel
- **Backend / BDD / Auth** : Supabase (Postgres + Auth + Row Level Security)
- **Stockage vidéos / contenus** : Cloudflare R2, bucket **privé** (accès
  uniquement via URL signée temporaire)
- **Paiement** : CinetPay (M-Pesa / Airtel Money / Orange Money)

## Démarrage

```bash
npm install
cp .env.example .env.local   # renseigner les clés Supabase / CinetPay / R2
npm run dev
```

### Base de données

Appliquer les migrations `supabase/migrations/*.sql` **dans l'ordre** sur
un projet Supabase (via le SQL editor, ou `supabase db push` avec la CLI
officielle) — chaque fichier est une migration incrémentale sur le schéma
existant, jamais un `DROP`/recréation depuis zéro.

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
- qu'une offre WhatsApp ne peut jamais descendre sous 20$, même par
  UPDATE direct sur la colonne `prix`, et qu'un champ JSON `config` ne peut
  pas contourner cette règle ;
- qu'une transaction jamais acceptée par le créateur est bien remboursée
  automatiquement une fois `deadline_acceptation` dépassée, et qu'une
  transaction acceptée mais jamais livrée l'est aussi une fois
  `deadline_livraison` dépassée ;
- que les 4 nouveaux types d'offres sont acceptés, qu'un `don` peut avoir
  un `prix` nul (et lui seul), et qu'un créateur ne peut pas avoir deux
  offres du même type (`unique_offre_type_par_createur`) ;
- que `video` fait exception à cette règle : deux offres vidéo avec des
  libellés différents ("Anniversaire", "Danse") passent, mais un second
  `video` avec le MÊME libellé (ou un second `whatsapp`/`don`/etc., dont le
  libellé reste toujours `null`) est toujours rejeté.

## Offres disponibles (brief v3 point 2)

| Type | Cycle de vie | Prix |
|---|---|---|
| `video` | Acceptation créateur (24h) puis livraison (48h) via URL R2 signée. Seul type qui n'est PAS limité à une offre par créateur : plusieurs vidéos avec des libellés différents ("Anniversaire" à 10$, "Danse" à 15$) peuvent coexister (`unique(createur_id, type, libelle)`, `NULLS NOT DISTINCT` pour que les autres types restent strictement à une offre) | fixé par le créateur, par libellé |
| `shoutout` | Identique à `video` (mêmes délais, même mécanisme de livraison) | fixé par le créateur |
| `whatsapp` | Acceptation créateur (48h) ; l'acceptation EST la livraison (numéro révélé) | ≥ 20$, imposé en base |
| `don` | Validation/livraison immédiates au paiement, aucun remboursement possible | libre, choisi par le fan |
| `contenu_debloque` | Contenu uploadé une seule fois par le créateur (`offres.config.r2_key`) ; chaque paiement débloque l'accès au même fichier ; validation/livraison immédiates | fixé par le créateur |
| `evenement_live` | Le créateur renseigne un lien externe (`offres.config.lien_live`) ; le paiement révèle ce lien ; validation/livraison immédiates | fixé par le créateur |

`contenu_debloque` et `evenement_live` sont livrés complets dans cette
version (pas de placeholder) ; leurs feature flags
(`contenu_debloque_actif`, `evenement_live_actif` dans
`parametres_plateforme`) existent comme demandé mais sont **actifs par
défaut** — à la différence de `abonnements_actifs`/`avis_actifs`/
`multi_devise_actif`, qui restent de vrais placeholders non codés. Pour les
désactiver le temps d'un lancement plus progressif, il suffit de passer
leur `valeur` à `false` dans `parametres_plateforme` (aucun redéploiement
nécessaire).

**Affiliation créateur → créateur** : aucun changement technique -- c'est
le mécanisme de parrainage existant (`parrainages`, `users.parrain_id`,
lien `?ref=`), qui s'applique maintenant à n'importe quelle paire
d'utilisateurs puisque la distinction fan/créateur a disparu.

## Points de sécurité notables

Section 0 du brief original :
- `src/lib/cinetpay.ts` : vérification HMAC-SHA256 réelle du webhook
  CinetPay, fail-closed (rejet si signature absente/invalide/clé non
  configurée).
- `supabase/migrations/0001_schema.sql` : contrainte `check_whatsapp_minimum_price`
  directement sur la colonne `offres.prix` (seuil actuel : 20$, voir
  migration 0006).
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

Trouvé en retirant la distinction de rôles (migration 0006, pas un des 5
points numérotés mais une conséquence directe du point 1) : la policy RLS
publique sur `users` (`role in ('createur','both')`) exposait la colonne
`telephone` de n'importe quel compte à n'importe quel appelant authentifié
qui interrogeait la table directement -- RLS filtre des lignes, pas des
colonnes, et cette condition matchait presque tous les comptes. Même
problème sur `offres.config` (peut contenir `evenement_live.lien_live`,
censé rester caché avant paiement). Remplacé par deux vues
(`profils_publics`, `offres_publiques`) qui n'exposent jamais ces colonnes,
quel que soit l'appelant ; les routes qui ont légitimement besoin de lire
la colonne sensible d'un AUTRE utilisateur (whatsapp-link, content-url,
live-link) le font désormais via le client service-role, après avoir
elles-mêmes revérifié `fan_id = auth.uid()` et `statut = 'livree'`. Vérifié
en interrogeant directement `users`/`offres` en tant qu'utilisateur
authentifié tiers (0 ligne retournée) puis via les vues (données publiques
correctement retournées).

## Internationalisation (next-intl)

Français par défaut (`localePrefix: "as-needed"` : le français n'a pas de
préfixe d'URL -- `/`, `/signup`, `/createur/x` -- seul l'anglais est
préfixé -- `/en`, `/en/signup`, `/en/createur/x`). Toutes les pages vivent
sous `src/app/[locale]/...` (structure standard next-intl pour l'App
Router) ; `src/proxy.ts` compose le middleware next-intl avec le
rafraîchissement de session Supabase existant (les cookies de session
s'écrivent sur la même réponse que celle produite par next-intl -- voir le
commentaire dans le fichier). Les routes `src/app/api/**` et
`src/app/auth/callback` restent délibérément HORS de `[locale]` : ce ne
sont pas des pages, et un `rewrite` next-intl dessus les ferait 404.

Traduit intégralement (fr + en), par priorité de ce que rencontre un
visiteur étranger en premier : accueil (`/`), inscription, connexion, page
créateur/paiement, retour de paiement. Le tableau de bord et les futurs
emails restent en français pour l'instant (contenu non traduit,
volontairement, moins prioritaire pour ce MVP) -- ajouter leurs clés dans
`messages/fr.json`/`messages/en.json` le jour où ils doivent l'être ne
demande aucun changement structurel.

Sélecteur de langue : `src/components/LanguageSwitcher.tsx`, présent sur
toutes les pages via `[locale]/layout.tsx`.

## Identifiant public (@pseudo), profil enrichi, classements, notifications

**Pseudo / handle public** (`fanboss.app/@pseudo`, réglable dans
`/parametres`) : `users.pseudo`, unique insensible à la casse (index
fonctionnel sur `lower(pseudo)`), format `[a-zA-Z0-9_]{3,20}` et liste
noire de mots réservés, tous imposés en base (migration 0008) -- vérifié
directement en base, pas seulement dans le schéma zod de l'API. La route
est `src/app/[locale]/[handle]/page.tsx`, volontairement PAS un dossier
`@[pseudo]` (Next.js réserve un `@` en tête de nom de dossier aux routes
parallèles) : `[handle]` capture tout le segment, `@sergio` inclus, et le
code retire le `@` avant de chercher le pseudo (404 sinon). `/createur/[id]`
reste la route canonique/interne ; `/@pseudo` n'est qu'un alias public
par-dessus, les deux rendent exactement la même vue
(`CreateurProfileView`/`getCreateurProfileData`).

**Profil enrichi** : bio, photo de profil, lien réseau social
(`users.bio`, `users.photo_r2_key`, `users.lien_reseau_social`). Bio et
lien social sont collectés à l'inscription (texte simple, même mécanisme
que téléphone/pays) ; la photo ne l'est PAS -- l'upload demande une URL
R2 signée qui nécessite un compte déjà authentifié, donc elle se fait
uniquement dans `/parametres`, après création du compte
(`/api/profil/photo-upload-url`). La photo n'est pas sensible mais passe
quand même par une URL signée comme le reste du contenu R2, juste avec
une expiration plus longue (24h) plutôt qu'une URL publique permanente.

**Classements** (30 jours glissants, opt-in via une case dans
`/parametres`) : volume de transactions livrées, réactivité (délai moyen
de réponse aux demandes vidéo/shoutout/whatsapp, calculé depuis
`transactions.repondu_at` -- un timestamp que `accept_transaction`/
`refuse_transaction` posent désormais, absent des remboursements
automatiques du cron pour ne jamais compter une non-réponse comme
"réactive"), progression (comptes créés il y a moins de 30 jours, classés
par leur volume). Les 3 vues SQL (`classement_volume`,
`classement_reactivite`, `classement_progression`) n'exposent QUE le rang,
jamais le nombre ou le montant sous-jacent, et ne listent que les
utilisateurs opt-in -- vérifié qu'aucune colonne monétaire/comptage n'y
apparaît et qu'un utilisateur non opt-in n'y figure jamais.

**Badge de notification** : `users.dernier_vu_demandes_at`, comparé aux
demandes reçues à chaque chargement du dashboard pour afficher un badge
"N nouvelle(s)" sur la section, puis mis à jour à `now()` -- la prochaine
visite ne compte que les demandes arrivées entre-temps.

## Hors scope du MVP

App mobile native, interface admin custom (Supabase Studio suffit), API
WhatsApp Business officielle, abonnements/avis/multi-devise (prévus en
feature flags désactivés dans `parametres_plateforme`), vérification
d'identité automatisée.
