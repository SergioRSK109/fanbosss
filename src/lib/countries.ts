// FanBoss's world country list -- backs the signup form's searchable
// country/dial-code picker (SignupForm.tsx + CountrySelect.tsx) and, for
// the handful of countries below that carry a `provinces` array, turns
// the signup province field from free text into a dropdown for that one
// country.
//
// ~194 entries: every ISO 3166-1 sovereign state (the 193 UN member
// states plus Vatican City -- the same "independent" population most
// country pickers use, deliberately excluding dependent territories like
// Hong Kong, Puerto Rico, or French Guiana, which have no "pays" value of
// their own separate from their sovereign state in this app's signup
// flow). Generated from two independently-maintained, widely-used
// datasets rather than typed by hand or recalled from memory -- see
// CLAUDE.md's own "src/lib/countries.ts" section for the exact generation
// method, what was cross-checked against an independent source (RD Congo
// + its 9 neighbouring countries, plus a random sample of 20 others, all
// matched), and the handful of entries manually corrected afterward
// (Eswatini and Cap-Vert, whose generated French names were outdated;
// El Salvador and Palaos, whose generated French names were awkward
// literal translations; RD Congo and Congo-Brazzaville, kept matching
// this app's pre-existing short names rather than the generated longer
// official forms, so `users.pays` keeps meaning the same thing for
// accounts created before and after this list was rewritten).
//
// -----------------------------------------------------------------------
// COMMENT ÉTENDRE CE FICHIER À LA MAIN
// -----------------------------------------------------------------------
// Pour ajouter/compléter les provinces d'un pays : trouve son entrée
// ci-dessous (recherche par le nom ou le code ISO), et ajoute un tableau
// `provinces: [...]` avec les noms exacts, dans l'ordre alphabétique.
// Exemple concret :
//   { code: "FR", name: "France", nameEn: "France", dial: "+33",
//     provinces: ["Auvergne-Rhône-Alpes", "Bourgogne-Franche-Comté", ...] }
// Un pays sans `provinces` (ou avec un tableau vide) garde un simple champ
// texte libre à l'inscription -- ajouter le tableau suffit à faire
// apparaître un menu déroulant à la place, rien d'autre à changer dans le
// reste du code.
//
// Pour corriger un nom : modifie directement `name` (le nom affiché en
// français) ou `nameEn` (en anglais) sur la ligne du pays concerné -- ce
// sont de simples chaînes de caractères, aucune autre partie du code n'a
// besoin de changer. Une mise en garde tout de même : `users.pays` stocke
// ce `name` tel quel au moment de l'inscription (voir CLAUDE.md), donc
// corriger une coquille est sans risque, mais changer complètement un nom
// déjà utilisé fera que les nouveaux inscrits auront une valeur différente
// de celle déjà enregistrée pour les comptes existants du même pays.
//
// Ne touche pas à `code` (le code ISO 3166-1 alpha-2) une fois un pays
// ajouté -- rien dans ce fichier n'en dépend pour l'instant, mais c'est la
// seule valeur ici qui a vocation à rester stable dans le temps.
export interface Country {
  code: string;
  name: string;
  nameEn: string;
  dial: string;
  provinces?: string[];
}

export const COUNTRIES: Country[] = [
  { code: "AF", name: "Afghanistan", nameEn: "Afghanistan", dial: "+93" },
  { code: "ZA", name: "Afrique du Sud", nameEn: "South Africa", dial: "+27" },
  { code: "AL", name: "Albanie", nameEn: "Albania", dial: "+355" },
  { code: "DZ", name: "Algérie", nameEn: "Algeria", dial: "+213" },
  {
    code: "DE", name: "Allemagne", nameEn: "Germany", dial: "+49",
    provinces: [
      "Bade-Wurtemberg",
      "Basse-Saxe",
      "Bavière",
      "Berlin",
      "Brandebourg",
      "Brême",
      "Hambourg",
      "Hesse",
      "Mecklembourg-Poméranie-Occidentale",
      "Rhénanie-du-Nord-Westphalie",
      "Rhénanie-Palatinat",
      "Sarre",
      "Saxe",
      "Saxe-Anhalt",
      "Schleswig-Holstein",
      "Thuringe",
    ],
  },
  { code: "AD", name: "Andorre", nameEn: "Andorra", dial: "+376" },
  {
    code: "AO", name: "Angola", nameEn: "Angola", dial: "+244",
    provinces: [
      "Bengo",
      "Benguela",
      "Bié",
      "Cabinda",
      "Cuando Cubango",
      "Cuanza Norte",
      "Cuanza Sul",
      "Cunène",
      "Huambo",
      "Huíla",
      "Luanda",
      "Lunda Norte",
      "Lunda Sul",
      "Malanje",
      "Moxico",
      "Namibe",
      "Uíge",
      "Zaïre",
    ],
  },
  { code: "AG", name: "Antigua-et-Barbuda", nameEn: "Antigua and Barbuda", dial: "+1268" },
  { code: "SA", name: "Arabie Saoudite", nameEn: "Saudi Arabia", dial: "+966" },
  { code: "AR", name: "Argentine", nameEn: "Argentina", dial: "+54" },
  { code: "AM", name: "Arménie", nameEn: "Armenia", dial: "+374" },
  { code: "AU", name: "Australie", nameEn: "Australia", dial: "+61" },
  { code: "AT", name: "Autriche", nameEn: "Austria", dial: "+43" },
  { code: "AZ", name: "Azerbaïdjan", nameEn: "Azerbaijan", dial: "+994" },
  { code: "BS", name: "Bahamas", nameEn: "Bahamas", dial: "+1242" },
  { code: "BH", name: "Bahreïn", nameEn: "Bahrain", dial: "+973" },
  { code: "BD", name: "Bangladesh", nameEn: "Bangladesh", dial: "+880" },
  { code: "BB", name: "Barbade", nameEn: "Barbados", dial: "+1246" },
  {
    code: "BE", name: "Belgique", nameEn: "Belgium", dial: "+32",
    provinces: [
      "Anvers",
      "Brabant flamand",
      "Brabant wallon",
      "Bruxelles-Capitale",
      "Flandre-Occidentale",
      "Flandre-Orientale",
      "Hainaut",
      "Liège",
      "Limbourg",
      "Luxembourg",
      "Namur",
    ],
  },
  { code: "BZ", name: "Belize", nameEn: "Belize", dial: "+501" },
  { code: "BJ", name: "Bénin", nameEn: "Benin", dial: "+229" },
  { code: "BT", name: "Bhoutan", nameEn: "Bhutan", dial: "+975" },
  { code: "BY", name: "Biélorussie", nameEn: "Belarus", dial: "+375" },
  { code: "MM", name: "Birmanie", nameEn: "Myanmar", dial: "+95" },
  { code: "BO", name: "Bolivie", nameEn: "Bolivia", dial: "+591" },
  { code: "BA", name: "Bosnie-Herzégovine", nameEn: "Bosnia and Herzegovina", dial: "+387" },
  { code: "BW", name: "Botswana", nameEn: "Botswana", dial: "+267" },
  { code: "BR", name: "Brésil", nameEn: "Brazil", dial: "+55" },
  { code: "BN", name: "Brunei", nameEn: "Brunei", dial: "+673" },
  { code: "BG", name: "Bulgarie", nameEn: "Bulgaria", dial: "+359" },
  { code: "BF", name: "Burkina Faso", nameEn: "Burkina Faso", dial: "+226" },
  {
    code: "BI", name: "Burundi", nameEn: "Burundi", dial: "+257",
    provinces: [
      "Buhumuza",
      "Bujumbura",
      "Burunga",
      "Butanyerera",
      "Gitega",
    ],
  },
  { code: "KH", name: "Cambodge", nameEn: "Cambodia", dial: "+855" },
  { code: "CM", name: "Cameroun", nameEn: "Cameroon", dial: "+237" },
  {
    code: "CA", name: "Canada", nameEn: "Canada", dial: "+1",
    provinces: [
      "Alberta",
      "Colombie-Britannique",
      "Île-du-Prince-Édouard",
      "Manitoba",
      "Nouveau-Brunswick",
      "Nouvelle-Écosse",
      "Nunavut",
      "Ontario",
      "Québec",
      "Saskatchewan",
      "Terre-Neuve-et-Labrador",
      "Territoires du Nord-Ouest",
      "Yukon",
    ],
  },
  { code: "CV", name: "Cap-Vert", nameEn: "Cape Verde", dial: "+238" },
  { code: "CL", name: "Chili", nameEn: "Chile", dial: "+56" },
  { code: "CN", name: "Chine", nameEn: "China", dial: "+86" },
  { code: "CY", name: "Chypre", nameEn: "Cyprus", dial: "+357" },
  { code: "VA", name: "Cité du Vatican", nameEn: "Vatican City", dial: "+39" },
  { code: "CO", name: "Colombie", nameEn: "Colombia", dial: "+57" },
  { code: "KM", name: "Comores", nameEn: "Comoros", dial: "+269" },
  {
    code: "CG", name: "Congo-Brazzaville", nameEn: "Congo-Brazzaville", dial: "+242",
    provinces: [
      "Bouenza",
      "Brazzaville",
      "Cuvette",
      "Cuvette-Ouest",
      "Kouilou",
      "Lékoumou",
      "Likouala",
      "Niari",
      "Plateaux",
      "Pointe-Noire",
      "Pool",
      "Sangha",
    ],
  },
  { code: "KP", name: "Corée du Nord", nameEn: "North Korea", dial: "+850" },
  { code: "KR", name: "Corée du Sud", nameEn: "South Korea", dial: "+82" },
  { code: "CR", name: "Costa Rica", nameEn: "Costa Rica", dial: "+506" },
  { code: "CI", name: "Côte d'Ivoire", nameEn: "Ivory Coast", dial: "+225" },
  { code: "HR", name: "Croatie", nameEn: "Croatia", dial: "+385" },
  { code: "CU", name: "Cuba", nameEn: "Cuba", dial: "+53" },
  { code: "DK", name: "Danemark", nameEn: "Denmark", dial: "+45" },
  { code: "DJ", name: "Djibouti", nameEn: "Djibouti", dial: "+253" },
  { code: "DM", name: "Dominique", nameEn: "Dominica", dial: "+1767" },
  { code: "EG", name: "Égypte", nameEn: "Egypt", dial: "+20" },
  { code: "SV", name: "El Salvador", nameEn: "El Salvador", dial: "+503" },
  { code: "AE", name: "Émirats arabes unis", nameEn: "United Arab Emirates", dial: "+971" },
  { code: "EC", name: "Équateur", nameEn: "Ecuador", dial: "+593" },
  { code: "ER", name: "Érythrée", nameEn: "Eritrea", dial: "+291" },
  { code: "ES", name: "Espagne", nameEn: "Spain", dial: "+34" },
  { code: "EE", name: "Estonie", nameEn: "Estonia", dial: "+372" },
  { code: "SZ", name: "Eswatini", nameEn: "Eswatini", dial: "+268" },
  {
    code: "US", name: "États-Unis", nameEn: "United States", dial: "+1",
    provinces: [
      "Alabama",
      "Alaska",
      "Arizona",
      "Arkansas",
      "Californie",
      "Caroline du Nord",
      "Caroline du Sud",
      "Colorado",
      "Connecticut",
      "Dakota du Nord",
      "Dakota du Sud",
      "Delaware",
      "District de Columbia",
      "Floride",
      "Géorgie",
      "Hawaii",
      "Idaho",
      "Illinois",
      "Indiana",
      "Iowa",
      "Kansas",
      "Kentucky",
      "Louisiane",
      "Maine",
      "Maryland",
      "Massachusetts",
      "Michigan",
      "Minnesota",
      "Mississippi",
      "Missouri",
      "Montana",
      "Nebraska",
      "Nevada",
      "New Hampshire",
      "New Jersey",
      "New Mexico",
      "New York",
      "Ohio",
      "Oklahoma",
      "Oregon",
      "Pennsylvanie",
      "Rhode Island",
      "Tennessee",
      "Texas",
      "Utah",
      "Vermont",
      "Virginie",
      "Virginie-Occidentale",
      "Washington",
      "Wisconsin",
      "Wyoming",
    ],
  },
  { code: "ET", name: "Éthiopie", nameEn: "Ethiopia", dial: "+251" },
  { code: "FJ", name: "Fidji", nameEn: "Fiji", dial: "+679" },
  { code: "FI", name: "Finlande", nameEn: "Finland", dial: "+358" },
  {
    code: "FR", name: "France", nameEn: "France", dial: "+33",
    provinces: [
      "Auvergne-Rhône-Alpes",
      "Bourgogne-Franche-Comté",
      "Bretagne",
      "Centre-Val de Loire",
      "Corse",
      "Grand Est",
      "Guadeloupe",
      "Guyane",
      "Hauts-de-France",
      "Île-de-France",
      "La Réunion",
      "Martinique",
      "Mayotte",
      "Normandie",
      "Nouvelle-Aquitaine",
      "Occitanie",
      "Pays de la Loire",
      "Provence-Alpes-Côte d'Azur",
    ],
  },
  { code: "GA", name: "Gabon", nameEn: "Gabon", dial: "+241" },
  { code: "GM", name: "Gambie", nameEn: "Gambia", dial: "+220" },
  { code: "GE", name: "Géorgie", nameEn: "Georgia", dial: "+995" },
  { code: "GH", name: "Ghana", nameEn: "Ghana", dial: "+233" },
  { code: "GR", name: "Grèce", nameEn: "Greece", dial: "+30" },
  { code: "GD", name: "Grenade", nameEn: "Grenada", dial: "+1473" },
  { code: "GT", name: "Guatemala", nameEn: "Guatemala", dial: "+502" },
  { code: "GN", name: "Guinée", nameEn: "Guinea", dial: "+224" },
  { code: "GQ", name: "Guinée équatoriale", nameEn: "Equatorial Guinea", dial: "+240" },
  { code: "GW", name: "Guinée-Bissau", nameEn: "Guinea-Bissau", dial: "+245" },
  { code: "GY", name: "Guyana", nameEn: "Guyana", dial: "+592" },
  { code: "HT", name: "Haïti", nameEn: "Haiti", dial: "+509" },
  { code: "HN", name: "Honduras", nameEn: "Honduras", dial: "+504" },
  { code: "HU", name: "Hongrie", nameEn: "Hungary", dial: "+36" },
  { code: "MU", name: "Île Maurice", nameEn: "Mauritius", dial: "+230" },
  { code: "MH", name: "Îles Marshall", nameEn: "Marshall Islands", dial: "+692" },
  { code: "SB", name: "Îles Salomon", nameEn: "Solomon Islands", dial: "+677" },
  { code: "IN", name: "Inde", nameEn: "India", dial: "+91" },
  { code: "ID", name: "Indonésie", nameEn: "Indonesia", dial: "+62" },
  { code: "IQ", name: "Irak", nameEn: "Iraq", dial: "+964" },
  { code: "IR", name: "Iran", nameEn: "Iran", dial: "+98" },
  { code: "IE", name: "Irlande", nameEn: "Ireland", dial: "+353" },
  { code: "IS", name: "Islande", nameEn: "Iceland", dial: "+354" },
  { code: "IL", name: "Israël", nameEn: "Israel", dial: "+972" },
  { code: "IT", name: "Italie", nameEn: "Italy", dial: "+39" },
  { code: "JM", name: "Jamaïque", nameEn: "Jamaica", dial: "+1876" },
  { code: "JP", name: "Japon", nameEn: "Japan", dial: "+81" },
  { code: "JO", name: "Jordanie", nameEn: "Jordan", dial: "+962" },
  { code: "KZ", name: "Kazakhstan", nameEn: "Kazakhstan", dial: "+7" },
  { code: "KE", name: "Kenya", nameEn: "Kenya", dial: "+254" },
  { code: "KG", name: "Kirghizistan", nameEn: "Kyrgyzstan", dial: "+996" },
  { code: "KI", name: "Kiribati", nameEn: "Kiribati", dial: "+686" },
  { code: "KW", name: "Koweït", nameEn: "Kuwait", dial: "+965" },
  { code: "LA", name: "Laos", nameEn: "Laos", dial: "+856" },
  { code: "LS", name: "Lesotho", nameEn: "Lesotho", dial: "+266" },
  { code: "LV", name: "Lettonie", nameEn: "Latvia", dial: "+371" },
  { code: "LB", name: "Liban", nameEn: "Lebanon", dial: "+961" },
  { code: "LR", name: "Liberia", nameEn: "Liberia", dial: "+231" },
  { code: "LY", name: "Libye", nameEn: "Libya", dial: "+218" },
  { code: "LI", name: "Liechtenstein", nameEn: "Liechtenstein", dial: "+423" },
  { code: "LT", name: "Lituanie", nameEn: "Lithuania", dial: "+370" },
  { code: "LU", name: "Luxembourg", nameEn: "Luxembourg", dial: "+352" },
  { code: "MK", name: "Macédoine du Nord", nameEn: "North Macedonia", dial: "+389" },
  { code: "MG", name: "Madagascar", nameEn: "Madagascar", dial: "+261" },
  { code: "MY", name: "Malaisie", nameEn: "Malaysia", dial: "+60" },
  { code: "MW", name: "Malawi", nameEn: "Malawi", dial: "+265" },
  { code: "MV", name: "Maldives", nameEn: "Maldives", dial: "+960" },
  { code: "ML", name: "Mali", nameEn: "Mali", dial: "+223" },
  { code: "MT", name: "Malte", nameEn: "Malta", dial: "+356" },
  { code: "MA", name: "Maroc", nameEn: "Morocco", dial: "+212" },
  { code: "MR", name: "Mauritanie", nameEn: "Mauritania", dial: "+222" },
  { code: "MX", name: "Mexique", nameEn: "Mexico", dial: "+52" },
  { code: "FM", name: "Micronésie", nameEn: "Micronesia", dial: "+691" },
  { code: "MD", name: "Moldavie", nameEn: "Moldova", dial: "+373" },
  { code: "MC", name: "Monaco", nameEn: "Monaco", dial: "+377" },
  { code: "MN", name: "Mongolie", nameEn: "Mongolia", dial: "+976" },
  { code: "ME", name: "Monténégro", nameEn: "Montenegro", dial: "+382" },
  { code: "MZ", name: "Mozambique", nameEn: "Mozambique", dial: "+258" },
  { code: "NA", name: "Namibie", nameEn: "Namibia", dial: "+264" },
  { code: "NR", name: "Nauru", nameEn: "Nauru", dial: "+674" },
  { code: "NP", name: "Népal", nameEn: "Nepal", dial: "+977" },
  { code: "NI", name: "Nicaragua", nameEn: "Nicaragua", dial: "+505" },
  { code: "NE", name: "Niger", nameEn: "Niger", dial: "+227" },
  { code: "NG", name: "Nigéria", nameEn: "Nigeria", dial: "+234" },
  { code: "NO", name: "Norvège", nameEn: "Norway", dial: "+47" },
  { code: "NZ", name: "Nouvelle-Zélande", nameEn: "New Zealand", dial: "+64" },
  { code: "OM", name: "Oman", nameEn: "Oman", dial: "+968" },
  {
    code: "UG", name: "Ouganda", nameEn: "Uganda", dial: "+256",
    provinces: [
      "Centre",
      "Est",
      "Nord",
      "Ouest",
    ],
  },
  { code: "UZ", name: "Ouzbékistan", nameEn: "Uzbekistan", dial: "+998" },
  { code: "PK", name: "Pakistan", nameEn: "Pakistan", dial: "+92" },
  { code: "PW", name: "Palaos", nameEn: "Palau", dial: "+680" },
  { code: "PA", name: "Panama", nameEn: "Panama", dial: "+507" },
  { code: "PG", name: "Papouasie-Nouvelle-Guinée", nameEn: "Papua New Guinea", dial: "+675" },
  { code: "PY", name: "Paraguay", nameEn: "Paraguay", dial: "+595" },
  { code: "NL", name: "Pays-Bas", nameEn: "Netherlands", dial: "+31" },
  { code: "PE", name: "Pérou", nameEn: "Peru", dial: "+51" },
  { code: "PH", name: "Philippines", nameEn: "Philippines", dial: "+63" },
  { code: "PL", name: "Pologne", nameEn: "Poland", dial: "+48" },
  {
    code: "PT", name: "Portugal", nameEn: "Portugal", dial: "+351",
    provinces: [
      "Açores",
      "Aveiro",
      "Beja",
      "Braga",
      "Bragance",
      "Castelo Branco",
      "Coïmbra",
      "Évora",
      "Faro",
      "Guarda",
      "Leiria",
      "Lisbonne",
      "Madère",
      "Portalegre",
      "Porto",
      "Santarém",
      "Setúbal",
      "Viana do Castelo",
      "Vila Real",
      "Viseu",
    ],
  },
  { code: "QA", name: "Qatar", nameEn: "Qatar", dial: "+974" },
  {
    code: "CD", name: "RD Congo", nameEn: "DR Congo", dial: "+243",
    provinces: [
      "Bas-Uele",
      "Équateur",
      "Haut-Katanga",
      "Haut-Lomami",
      "Haut-Uele",
      "Ituri",
      "Kasaï",
      "Kasaï-Central",
      "Kasaï-Oriental",
      "Kinshasa",
      "Kongo-Central",
      "Kwango",
      "Kwilu",
      "Lomami",
      "Lualaba",
      "Mai-Ndombe",
      "Maniema",
      "Mongala",
      "Nord-Kivu",
      "Nord-Ubangi",
      "Sankuru",
      "Sud-Kivu",
      "Sud-Ubangi",
      "Tanganyika",
      "Tshopo",
      "Tshuapa",
    ],
  },
  {
    code: "CF", name: "République centrafricaine", nameEn: "Central African Republic", dial: "+236",
    provinces: [
      "Bamingui-Bangoran",
      "Bangui",
      "Basse-Kotto",
      "Haut-Mbomou",
      "Haute-Kotto",
      "Kémo",
      "Lobaye",
      "Mambéré-Kadéï",
      "Mbomou",
      "Nana-Grébizi",
      "Nana-Mambéré",
      "Ombella-M'Poko",
      "Ouaka",
      "Ouham",
      "Ouham-Pendé",
      "Sangha-Mbaéré",
      "Vakaga",
    ],
  },
  { code: "DO", name: "République dominicaine", nameEn: "Dominican Republic", dial: "+1" },
  { code: "RO", name: "Roumanie", nameEn: "Romania", dial: "+40" },
  {
    code: "GB", name: "Royaume-Uni", nameEn: "United Kingdom", dial: "+44",
    provinces: [
      "Angleterre",
      "Écosse",
      "Irlande du Nord",
      "Pays de Galles",
    ],
  },
  { code: "RU", name: "Russie", nameEn: "Russia", dial: "+7" },
  {
    code: "RW", name: "Rwanda", nameEn: "Rwanda", dial: "+250",
    provinces: [
      "Est",
      "Kigali",
      "Nord",
      "Ouest",
      "Sud",
    ],
  },
  { code: "KN", name: "Saint-Christophe-et-Niévès", nameEn: "Saint Kitts and Nevis", dial: "+1869" },
  { code: "SM", name: "Saint-Marin", nameEn: "San Marino", dial: "+378" },
  { code: "VC", name: "Saint-Vincent-et-les-Grenadines", nameEn: "Saint Vincent and the Grenadines", dial: "+1784" },
  { code: "LC", name: "Sainte-Lucie", nameEn: "Saint Lucia", dial: "+1758" },
  { code: "WS", name: "Samoa", nameEn: "Samoa", dial: "+685" },
  { code: "ST", name: "São Tomé et Príncipe", nameEn: "São Tomé and Príncipe", dial: "+239" },
  { code: "SN", name: "Sénégal", nameEn: "Senegal", dial: "+221" },
  { code: "RS", name: "Serbie", nameEn: "Serbia", dial: "+381" },
  { code: "SC", name: "Seychelles", nameEn: "Seychelles", dial: "+248" },
  { code: "SL", name: "Sierra Leone", nameEn: "Sierra Leone", dial: "+232" },
  { code: "SG", name: "Singapour", nameEn: "Singapore", dial: "+65" },
  { code: "SK", name: "Slovaquie", nameEn: "Slovakia", dial: "+421" },
  { code: "SI", name: "Slovénie", nameEn: "Slovenia", dial: "+386" },
  { code: "SO", name: "Somalie", nameEn: "Somalia", dial: "+252" },
  { code: "SD", name: "Soudan", nameEn: "Sudan", dial: "+249" },
  {
    code: "SS", name: "Soudan du Sud", nameEn: "South Sudan", dial: "+211",
    provinces: [
      "Bahr el Ghazal du Nord",
      "Bahr el Ghazal occidental",
      "Équatoria central",
      "Équatoria occidental",
      "Équatoria oriental",
      "Haut-Nil",
      "Jonglei",
      "Lacs",
      "Unité",
      "Warrap",
    ],
  },
  { code: "LK", name: "Sri Lanka", nameEn: "Sri Lanka", dial: "+94" },
  { code: "SE", name: "Suède", nameEn: "Sweden", dial: "+46" },
  {
    code: "CH", name: "Suisse", nameEn: "Switzerland", dial: "+41",
    provinces: [
      "Appenzell Rhodes-Extérieures",
      "Appenzell Rhodes-Intérieures",
      "Argovie",
      "Bâle-Campagne",
      "Bâle-Ville",
      "Berne",
      "Fribourg",
      "Genève",
      "Glaris",
      "Grisons",
      "Jura",
      "Lucerne",
      "Neuchâtel",
      "Nidwald",
      "Obwald",
      "Saint-Gall",
      "Schaffhouse",
      "Schwytz",
      "Soleure",
      "Tessin",
      "Thurgovie",
      "Uri",
      "Valais",
      "Vaud",
      "Zoug",
      "Zurich",
    ],
  },
  { code: "SR", name: "Surinam", nameEn: "Suriname", dial: "+597" },
  { code: "SY", name: "Syrie", nameEn: "Syria", dial: "+963" },
  { code: "TJ", name: "Tadjikistan", nameEn: "Tajikistan", dial: "+992" },
  {
    code: "TZ", name: "Tanzanie", nameEn: "Tanzania", dial: "+255",
    provinces: [
      "Arusha",
      "Dar es Salaam",
      "Dodoma",
      "Geita",
      "Iringa",
      "Kagera",
      "Katavi",
      "Kigoma",
      "Kilimandjaro",
      "Lindi",
      "Manyara",
      "Mara",
      "Mbeya",
      "Morogoro",
      "Mtwara",
      "Mwanza",
      "Njombe",
      "Pemba Nord",
      "Pemba Sud",
      "Pwani",
      "Rukwa",
      "Ruvuma",
      "Shinyanga",
      "Simiyu",
      "Singida",
      "Songwe",
      "Tabora",
      "Tanga",
      "Zanzibar Nord",
      "Zanzibar Ouest",
      "Zanzibar Sud",
    ],
  },
  { code: "TD", name: "Tchad", nameEn: "Chad", dial: "+235" },
  { code: "CZ", name: "Tchéquie", nameEn: "Czechia", dial: "+420" },
  { code: "TH", name: "Thaïlande", nameEn: "Thailand", dial: "+66" },
  { code: "TL", name: "Timor oriental", nameEn: "Timor-Leste", dial: "+670" },
  { code: "TG", name: "Togo", nameEn: "Togo", dial: "+228" },
  { code: "TO", name: "Tonga", nameEn: "Tonga", dial: "+676" },
  { code: "TT", name: "Trinité-et-Tobago", nameEn: "Trinidad and Tobago", dial: "+1868" },
  { code: "TN", name: "Tunisie", nameEn: "Tunisia", dial: "+216" },
  { code: "TM", name: "Turkménistan", nameEn: "Turkmenistan", dial: "+993" },
  { code: "TR", name: "Turquie", nameEn: "Türkiye", dial: "+90" },
  { code: "TV", name: "Tuvalu", nameEn: "Tuvalu", dial: "+688" },
  { code: "UA", name: "Ukraine", nameEn: "Ukraine", dial: "+380" },
  { code: "UY", name: "Uruguay", nameEn: "Uruguay", dial: "+598" },
  { code: "VU", name: "Vanuatu", nameEn: "Vanuatu", dial: "+678" },
  { code: "VE", name: "Venezuela", nameEn: "Venezuela", dial: "+58" },
  { code: "VN", name: "Viêt Nam", nameEn: "Vietnam", dial: "+84" },
  { code: "YE", name: "Yémen", nameEn: "Yemen", dial: "+967" },
  {
    code: "ZM", name: "Zambie", nameEn: "Zambia", dial: "+260",
    provinces: [
      "Centrale",
      "Copperbelt",
      "Luapula",
      "Lusaka",
      "Muchinga",
      "Nord",
      "Nord-Ouest",
      "Orientale",
      "Ouest",
      "Sud",
    ],
  },
  { code: "ZW", name: "Zimbabwe", nameEn: "Zimbabwe", dial: "+263" },
  // Deliberately kept outside this world list and always last -- not a
  // real ISO 3166-1 entry, but a long-standing fallback for a résidant
  // whose real country isn't (or can't yet be) one of the 194 above.
  // checkDeliveryZone()'s handling of this specific value has a known,
  // separate issue (two "Autre" users can look like they're in the same
  // country) that is explicitly out of scope for the lot that rewrote
  // this file -- see CLAUDE.md's own "src/lib/countries.ts" section.
  { code: "OTHER", name: "Autre", nameEn: "Other", dial: "" },
];

// next-intl's useLocale()/getLocale() both return a plain string (the
// active routing locale, "fr" or "en" per src/i18n/routing.ts) -- kept as
// `string` here rather than importing that literal union type, so this
// module never needs a dependency on next-intl at all.
export function getCountryName(country: Country, locale: string): string {
  return locale.startsWith("en") ? country.nameEn : country.name;
}

// NFD-normalizes and strips diacritics/case so "Cote" and "Côte" compare
// equal -- the same normalization approach CLAUDE.md documents this app
// already using nowhere else, so this is the first place it's needed.
function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Splits a name (a country's, or the visitor's own typed query) into its
// individual words, normalized -- shared by both sides of the match below
// so "CO" and "RD Congo" tokenize the exact same way.
function searchTokens(value: string): string[] {
  return normalizeForSearch(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Powers CountrySelect's live filtering. The query is itself split into
// words, and EVERY query word must prefix-match at least one word of the
// country's displayed name (in the given locale) -- not necessarily the
// same word twice, and not necessarily in order. A single-word query like
// "CO" matches whenever any name word starts with it, which is what finds
// "RD Congo" (its second word "Congo" starts with "co") alongside
// "Congo-Brazzaville"/"Colombie"/"Comores"/"Côte d'Ivoire". A multi-word
// query like "RD Congo" additionally requires "rd" to prefix-match some
// word too, so typing the country's full name still finds it -- a plain
// single-token prefix check against the whole name would otherwise never
// match a query longer than any individual word. An empty/whitespace-only
// query returns the full list unfiltered.
export function filterCountriesByQuery(
  countries: Country[],
  query: string,
  locale: string,
): Country[] {
  const queryTokens = searchTokens(query);
  if (queryTokens.length === 0) {
    return countries;
  }
  return countries.filter((country) => {
    const nameTokens = searchTokens(getCountryName(country, locale));
    return queryTokens.every((queryToken) =>
      nameTokens.some((nameToken) => nameToken.startsWith(queryToken)),
    );
  });
}

// Powers CountrySelect's arrow-key navigation -- pure so it's directly
// unit-testable without a DOM (this project has no jsdom/testing-library,
// same reasoning documented throughout CLAUDE.md for every other
// DOM-adjacent interaction in this codebase). Clamps to the results
// range rather than wrapping around, and never goes negative or past the
// last index even when the list is empty.
export function clampHighlightedIndex(
  currentIndex: number,
  delta: number,
  resultsLength: number,
): number {
  if (resultsLength <= 0) {
    return 0;
  }
  return Math.min(Math.max(currentIndex + delta, 0), resultsLength - 1);
}
