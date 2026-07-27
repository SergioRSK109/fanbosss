# FanBoss

Plateforme PWA permettant à n'importe quel utilisateur de monétiser sa
relation avec ses fans, via des offres : vidéo personnalisée, mention
(shoutout), don libre, accès WhatsApp premium, contenu à débloquer, accès
à un live privé, campagne de collecte de fonds. N'importe qui peut aussi
bien recevoir des paiements que payer quelqu'un d'autre — il n'y a pas de
distinction fan/créateur (brief v3 point 1).

> Pour l'historique complet des décisions de design, le détail exhaustif
> de chaque fonctionnalité et les tests qui les prouvent, voir
> `CLAUDE.md` à la racine du repo. Ce README reste volontairement un
> point d'entrée plus court.

## Stack

- **Frontend** : Next.js 16 (App Router, PWA) + Tailwind, déployé sur Vercel
- **Backend / BDD / Auth** : Supabase (Postgres + Auth + Row Level Security)
- **Stockage vidéos / contenus / photos** : Cloudflare R2, bucket **privé**
  (accès uniquement via URL signée temporaire — aucune URL publique
  n'existe nulle part dans ce projet)
- **Paiement** : CinetPay (M-Pesa / Airtel Money / Orange Money)
- **i18n** : next-intl, français par défaut + anglais (`/en`)

## Démarrage

```bash
npm install
cp .env.example .env.local   # renseigner les clés Supabase / CinetPay / R2
npm run dev
```

### Base de données

Les migrations `supabase/migrations/*.sql` (27 à ce jour) — toujours
incrémentales, jamais un `DROP`/recréation depuis zéro — sont appliquées
**automatiquement** sur le projet Supabase de production par
`.github/workflows/deploy-migrations.yml` à chaque push sur `main` qui
touche `supabase/migrations/`. Plus besoin de les copier-coller à la main
dans le SQL Editor.

#### Configuration requise (une seule fois, côté GitHub)

Le workflow a besoin de trois secrets, à ajouter soi-même dans **GitHub →
Settings → Secrets and variables → Actions → New repository secret** (ce
repo : Settings → Secrets and variables → Actions). Ne jamais les coller
ailleurs (issue, PR, chat) — Claude Code n'a besoin d'aucun de ces secrets
pour faire son travail.

| Secret GitHub | Où le récupérer dans le dashboard Supabase |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Compte → [Access Tokens](https://supabase.com/dashboard/account/tokens) → **Generate new token**. Voir "Scope du token" ci-dessous avant de le générer. |
| `SUPABASE_PROJECT_ID` | URL du projet dans le dashboard : `https://supabase.com/dashboard/project/<PROJECT_ID>` — c'est cette référence (ex. `abcdefghijklmnop`), pas le nom du projet. Aussi visible dans Project Settings → General → "Reference ID". |
| `SUPABASE_DB_PASSWORD` | Project Settings → Database → **Database password**. Si elle a été oubliée, un bouton "Reset database password" y génère une nouvelle valeur (réservé aux rôles Owner/Administrator — voir ci-dessous) ; bien répercuter tout changement dans ce secret GitHub. |

#### Scope du token — recommandation

Un Personal Access Token Supabase hérite **exactement** des permissions du
compte qui le génère (ce n'est pas un token indépendamment scopable après
coup). Pour éviter de stocker un secret GitHub avec un accès admin complet
à toute l'organisation :

1. Dans l'organisation Supabase, inviter (ou utiliser) un membre avec un
   rôle **Developer, restreint à ce seul projet** (project-scoped role),
   plutôt que le compte Owner personnel. D'après la matrice de permissions
   officielle de Supabase, ce rôle peut gérer les données/le schéma de la
   base (`Data (Database)` → `Manage` ✓, `SQL Editor` → `Run` ✓ — ce dont
   `db push` a besoin) mais ne peut ni transférer/supprimer le projet, ni
   changer les paramètres d'organisation, ni ajouter d'autres owners, ni
   réinitialiser lui-même le mot de passe de la base.
2. Générer `SUPABASE_ACCESS_TOKEN` depuis **ce** compte restreint, pas
   depuis le compte Owner.

**Limite honnête à connaître** : `SUPABASE_DB_PASSWORD` reste, lui, un vrai
mot de passe Postgres — une fois connu, il donne un accès direct complet à
la base (c'est un identifiant Postgres, pas une permission gérée par le
tableau de rôles du dashboard Supabase ci-dessus). Aucune option plus
étroite n'est documentée publiquement pour ce mot de passe spécifique à ce
jour ; la seule vraie protection est de limiter qui a accès à ce secret
GitHub (Settings → Secrets ne montre sa valeur à personne après
l'enregistrement, y compris aux mainteneurs).

#### En cas d'échec en CI

Un `supabase db push` qui échoue (erreur SQL, mauvais secret, connexion
refusée...) fait échouer le step et donc tout le workflow — aucun
`continue-on-error` ni `|| true` nulle part dans
`deploy-migrations.yml`. Concrètement :
- Le commit/la PR affiche une ❌ rouge dans les status checks GitHub.
- L'onglet **Actions** du repo montre le run en rouge, avec le message
  d'erreur exact de `supabase db push` dans les logs du step "Push new
  migrations".
- GitHub notifie par email l'auteur du commit (selon ses préférences de
  notification) qu'un workflow a échoué.

Pour corriger : lire l'erreur dans les logs, corriger le fichier de
migration fautif (jamais réécrire une migration déjà mergée sur `main` —
en ajouter une nouvelle qui corrige), commit, push. Le workflow ne
retente rien automatiquement — c'est volontaire, pour ne jamais réappliquer
une migration à moitié échouée sans supervision.

Pour un premier déploiement manuel (avant que ce workflow existe, ou pour
une base de test locale), les migrations restent applicables via le SQL
Editor du dashboard ou directement `supabase db push` en local, dans
l'ordre des fichiers.

### Déploiement (Vercel Hobby) et cron des deadlines

Le plan Vercel Hobby (gratuit) limite les cron jobs à une exécution par
jour maximum, ce qui est trop lent (un fan ne doit pas attendre 24h pour
être remboursé d'une demande jamais acceptée). Il n'y a donc pas de bloc
`crons` dans `vercel.json` — la route `/api/cron/check-deadlines` existe
toujours et vérifie toujours `Authorization: Bearer {CRON_SECRET}`
exactement comme avant, mais elle doit être appelée par un scheduler
externe gratuit plutôt que par Vercel.

Cette route enchaîne désormais **trois** RPC côté base de données à
chaque appel (chacune doit réussir pour que la route réponde 200) :
`process_transaction_deadlines()` (remboursement auto si le créateur
n'a jamais répondu/livré à temps), `close_expired_campagnes()` (clôture
des campagnes de collecte dont la date de fin est dépassée sans avoir
atteint l'objectif) et `process_confirmation_deadlines()` (confirmation
automatique d'une vidéo/shoutout livrée si le fan ne réagit pas sous 72h).

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
                   # routes de livraison signée, validation, calculs de
                   # commission, helpers de classement/campagnes/wallet...
npm run test:sql  # tests SQL de bout en bout, contre un vrai Postgres :
                   # applique toutes les migrations puis vérifie les
                   # contraintes, triggers, RLS et RPC (nécessite un
                   # cluster Postgres local accessible via
                   # `sudo -u postgres psql`)
```

`npm run test:sql` (`supabase/tests/checklist_2_3.sql`) crée une base
jetable, applique les 27 migrations dans l'ordre, et prouve concrètement
(pas juste "en théorie"), entre autres :
- qu'une offre WhatsApp ne peut jamais descendre sous 20$, même par
  UPDATE direct sur la colonne `prix`, et qu'un champ JSON `config` ne peut
  pas contourner cette règle ;
- qu'une transaction jamais acceptée par le créateur est bien remboursée
  automatiquement une fois `deadline_acceptation` dépassée, et qu'une
  transaction acceptée mais jamais livrée l'est aussi une fois
  `deadline_livraison` dépassée ;
- qu'un créateur ne peut pas avoir deux offres du même type
  (`unique_offre_type_par_createur`), sauf `video`/`campagne` qui
  admettent plusieurs offres distinguées par libellé ;
- que chaque fonction `SECURITY DEFINER` (acceptation/refus/livraison de
  transaction, vérification créateur, résolution de litige, retrait
  wallet, statut admin...) rejette un appelant anonyme (`anon`, permission
  Postgres réelle), un appelant authentifié sans session, un appelant qui
  n'a pas les droits nécessaires (pas admin, pas propriétaire de la
  ressource), et ne laisse aucune trace en cas de rejet ;
- que le calcul du solde wallet d'un créateur (voir plus bas) retombe
  exactement sur les montants attendus une fois la commission appliquée.

## Offres disponibles

| Type | Cycle de vie | Prix |
|---|---|---|
| `video` | Acceptation créateur (24h) puis livraison (48h) via URL R2 signée. Le fan a ensuite 72h pour confirmer la réception (sinon confirmation automatique) ou signaler un problème. Plusieurs offres vidéo avec des libellés différents ("Anniversaire" à 10$, "Danse" à 15$) peuvent coexister | fixé par le créateur, par libellé |
| `shoutout` | Identique à `video` (mêmes délais, même mécanisme de livraison et de confirmation) | fixé par le créateur |
| `whatsapp` | Acceptation créateur (48h) ; l'acceptation EST la livraison (numéro révélé) | ≥ 20$, imposé en base |
| `don` | Validation/livraison immédiates au paiement, aucun remboursement possible | libre, choisi par le fan |
| `contenu_debloque` | Contenu uploadé une seule fois par le créateur (`offres.config.r2_key`) ; chaque paiement débloque l'accès au même fichier ; validation/livraison immédiates | fixé par le créateur |
| `evenement_live` | Le créateur renseigne un lien externe (`offres.config.lien_live`) ; le paiement révèle ce lien ; validation/livraison immédiates | fixé par le créateur |
| `campagne` | Collecte de fonds à but libre (titre, description, objectif, date de fin optionnelle) ; mécaniquement un `don` avec montant collecté calculé en direct, clôturée automatiquement à l'objectif atteint ou à la date de fin | libre, choisi par le fan |

`contenu_debloque` et `evenement_live` sont livrés complets (pas de
placeholder) ; leurs feature flags (`contenu_debloque_actif`,
`evenement_live_actif` dans `parametres_plateforme`) existent comme
demandé mais sont **actifs par défaut** — à la différence de
`abonnements_actifs`/`avis_actifs`/`multi_devise_actif`, qui restent de
vrais placeholders non codés. Pour les désactiver le temps d'un lancement
plus progressif, il suffit de passer leur `valeur` à `false` dans
`parametres_plateforme` (aucun redéploiement nécessaire).

**Affiliation créateur → créateur** : aucun changement technique — c'est
le mécanisme de parrainage existant (`parrainages`, `users.parrain_id`,
lien `?ref=`), qui s'applique maintenant à n'importe quelle paire
d'utilisateurs puisque la distinction fan/créateur a disparu.

**Commission** : 15% hors-taxes + TVA (16% de la commission), le tout
répercuté sur le créateur — modèle classique d'intermédiation marketplace.
Les frais CinetPay (3%) restent absorbés par la plateforme. Formule
unique, jamais dupliquée, entre le SQL (`create_paiement_on_validation()`)
et son miroir JS (`calculerRepartitionPaiement()` dans
`src/lib/transactions.ts`).

## Fonctionnalités principales

Au-delà du parcours de paiement de base, la plateforme inclut :

- **`/explorer`** : annuaire public des créateurs (recherche, filtre par
  type d'offre), visibles par défaut dès leur première offre active
  (opt-out via `/parametres`).
- **`/classement`** : classements publics (volume, réactivité) sur 30
  jours glissants, opt-in, rang seul affiché (jamais le montant/nombre
  sous-jacent). Une carte privée sur le dashboard montre à chaque créateur
  sa propre progression réelle vers le top 10.
- **Vérification créateur** (`/parametres`, badge "✓ Vérifié") :
  palier 1 auto-servi (code à ajouter à sa bio TikTok/Instagram/YouTube,
  validé par un admin) avec détection de conflit de nom d'affichage ;
  palier 2 (KYC tiers en cas de conflit) reste une file d'attente pour
  revue humaine — aucune vérification automatisée par vidéo/selfie n'est
  implémentée, par choix produit explicite.
- **Badge de fidélité fan** : "Supporter de X depuis [date]", opt-in,
  visible sur le profil public du créateur soutenu et sur celui du fan.
- **État de confirmation + litiges** (vidéo/shoutout uniquement) : le fan
  a 72h après livraison pour confirmer ou signaler un problème ; un litige
  ouvre une revue admin (`/admin`) qui tranche en faveur du créateur ou du
  fan.
- **Wallet & retraits** (`/finance`) : solde du créateur réparti en trois
  compartiments (en attente de livraison / en litige / net à retirer),
  demande de retrait à partir de 25$ (revérifié côté serveur, jamais fait
  confiance à un montant envoyé par le client), traitée manuellement par
  un admin.
- **`/admin`** : tableau de bord business (gate `users.est_admin`, 404 —
  jamais une redirection — pour tout visiteur non admin) : vue
  d'ensemble du mois, remboursements manuels en attente, litiges,
  demandes de retrait, vérifications créateur, top créateurs, gestion des
  admins.
- **Mot de passe oublié / changement**, **déconnexion réelle**
  (invalidation serveur, pas seulement locale), **recadrage de photo de
  profil** (carré, style Instagram, entièrement côté client avant upload).

## Points de sécurité notables

- `src/lib/cinetpay.ts` : vérification HMAC-SHA256 réelle du webhook
  CinetPay, fail-closed (rejet si signature absente/invalide/clé non
  configurée).
- `supabase/migrations/0001_schema.sql` : contrainte `check_whatsapp_minimum_price`
  directement sur la colonne `offres.prix` (jamais sur le JSON `config`).
- Toute transition d'état d'une transaction (acceptation, refus,
  livraison, confirmation, résolution de litige, retrait wallet, statut
  admin) passe par une fonction Postgres `SECURITY DEFINER` — jamais par
  un UPDATE direct exposé au client.
- **Un vrai bug de sécurité trouvé et corrigé** (migrations 0020/0021) :
  `accept_transaction`/`refuse_transaction`/`deliver_video` utilisaient
  une comparaison `!=` avec `auth.uid()`, qui s'évalue silencieusement à
  `NULL` (donc "faux") quand l'appelant n'est pas authentifié — combiné à
  l'absence de `revoke ... from public` sur ces fonctions (Postgres
  accorde `EXECUTE` à `PUBLIC` par défaut), un appelant anonyme pouvait
  réellement modifier une transaction d'un tiers. Reproduit puis corrigé
  concrètement (pas juste supposé) : `is distinct from` à la place de
  `!=`, vérification explicite `auth.uid() is null`, et audit systématique
  de toutes les autres fonctions `SECURITY DEFINER` du projet pour le même
  oubli. Voir `CLAUDE.md` pour le détail complet de l'investigation.
- `src/app/api/webhooks/cinetpay/route.ts` : jointure explicite vers
  `offres` avant toute logique conditionnelle, avec vérification
  `if (!offerType) throw`.
- `src/lib/r2.ts` : bucket R2 privé, livraison uniquement via URL signée,
  après vérification `fan_id = auth.uid()` et `statut = 'livree'` (ou
  l'équivalent pour un accès déjà payé).
- RLS : chaque table sensible (`users`, `offres`, `transactions`,
  `paiements`, `demandes_retrait`...) restreint l'accès direct au
  propriétaire de la ligne ; les lectures publiques passent uniquement par
  des vues dédiées (`profils_publics`, `offres_publiques`,
  `classement_*`...) qui n'exposent jamais une colonne sensible, quel que
  soit l'appelant.

## Internationalisation (next-intl)

Français par défaut (`localePrefix: "as-needed"` : le français n'a pas de
préfixe d'URL — `/`, `/signup`, `/createur/x` — seul l'anglais est
préfixé — `/en`, `/en/signup`, `/en/createur/x`). Toutes les pages vivent
sous `src/app/[locale]/...` (structure standard next-intl pour l'App
Router) ; `src/proxy.ts` compose le middleware next-intl avec le
rafraîchissement de session Supabase existant. Les routes
`src/app/api/**` et `src/app/auth/callback` restent délibérément HORS de
`[locale]` : ce ne sont pas des pages, et un `rewrite` next-intl dessus
les ferait 404.

**Couverture intégrale (fr + en)** : accueil, inscription, connexion,
tableau de bord, `/parametres`, `/admin`, `/explorer`, `/classement`,
`/finance`, page créateur/paiement, retour de paiement, y compris les
textes générés dynamiquement (statuts de transaction, messages de
progression de classement). Deux catégories restent volontairement non
traduites, documentées dans `CLAUDE.md` : les messages d'erreur des
routes API (hors de `[locale]`, donc sans contexte de locale) et les
noms de pays/provinces à l'inscription (stockés tels quels pour rester
cohérents en base, indépendamment de la langue de saisie).

Sélecteur de langue : `src/components/LanguageSwitcher.tsx`, présent sur
toutes les pages via `[locale]/layout.tsx`.

## Identifiant public (@pseudo), profil, inscription

**Pseudo / handle public** (`fanboss.app/@pseudo`, réglable dans
`/parametres`, avec un cooldown de 30 jours entre deux changements
imposé par un trigger en base) : `users.pseudo`, unique insensible à la
casse (index fonctionnel sur `lower(pseudo)`), format
`[a-zA-Z0-9_]{3,20}` et liste noire de mots réservés, tous imposés en
base — vérifié directement en base, pas seulement dans le schéma zod de
l'API. La route est `src/app/[locale]/[handle]/page.tsx`, volontairement
PAS un dossier `@[pseudo]` (Next.js réserve un `@` en tête de nom de
dossier aux routes parallèles). `/createur/[id]` reste la route
canonique/interne ; `/@pseudo` n'est qu'un alias public par-dessus, les
deux rendent exactement la même vue (`CreateurProfileView`/
`getCreateurProfileData`).

**Profil enrichi** : nom d'affichage, bio, photo de profil (recadrée
côté client avant upload), liens TikTok/Instagram/YouTube/autre —
éditables uniquement depuis `/parametres`, après création du compte
(l'upload photo nécessite une URL R2 signée, donc un compte déjà
authentifié).

**Inscription** : nom/post-nom, pays + numéro de téléphone (indicatif
dépendant du pays), province/ville (dépendant du pays), date de
naissance avec vérification 18+ **imposée en base** (`check` constraint,
pas seulement côté client), mot de passe avec confirmation. Bio et photo
ne sont plus collectées à l'inscription — uniquement depuis
`/parametres` ensuite.

## Hors scope du MVP

App mobile native, interface admin custom au-delà de `/admin` (Supabase
Studio suffit pour le reste), API WhatsApp Business officielle,
abonnements/avis/multi-devise (prévus en feature flags désactivés dans
`parametres_plateforme`), vérification d'identité automatisée par
vidéo/selfie (KYC tiers) — le palier 1 auto-servi (code dans la bio) est
lui bien implémenté, voir "Vérification créateur" plus haut.
