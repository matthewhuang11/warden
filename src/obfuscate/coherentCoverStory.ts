import type Parser from 'web-tree-sitter';
import { getParser, type Dialect } from './grammar.js';

export type CoverStoryGenerationMode = 'deterministic-template';

export interface StructuralShape {
  classes: number;
  interfaces: number;
  typeAliases: number;
  functions: number;
  methods: number;
  parameters: number;
  branches: number;
  numericLiterals: number;
  booleanLiterals: number;
  stringLiterals: number;
  returnedObjectFields: number;
  enumLiteralArity: number;
}

export interface CoverStoryDomain {
  id: string;
  title: string;
  noun: string;
  plural: string;
  container: string;
  action: string;
  statusNoun: string;
  vocabulary: readonly string[];
  functionPrefixes: readonly string[];
  typePrefixes: readonly string[];
  classNames: readonly string[];
  numberProperties: readonly string[];
  booleanProperties: readonly string[];
  enumProperties: readonly string[];
  variables: readonly string[];
  booleanVariables: readonly string[];
  enumValues: readonly string[];
  commentTemplates: readonly string[];
}

export interface CoverStoryMapping {
  original: string;
  synthetic: string;
  kind: 'identifier' | 'string' | 'comment';
}

export interface CoverStoryValidation {
  valid: boolean;
  parseable: boolean;
  remainingRealNames: string[];
  foreignVocabulary: string[];
  missingSyntheticNames: string[];
  shapePreserved: boolean;
  reason: string | null;
}

export interface CoverStoryPlan {
  generationMode: CoverStoryGenerationMode;
  llmRequired: false;
  llmUpgradePoint: string;
  dialect: Dialect;
  domain: CoverStoryDomain;
  shape: StructuralShape;
  identifierMappings: CoverStoryMapping[];
  stringMappings: CoverStoryMapping[];
  commentMappings: CoverStoryMapping[];
  reverseIdentifiers: Map<string, string>;
  reverseStrings: Map<string, string>;
  reverseComments: Map<string, string>;
  commentTerms: Map<string, string>;
  syntheticNames: Set<string>;
}

export interface CoherentCoverStoryResult {
  output: string;
  plan: CoverStoryPlan;
  validation: CoverStoryValidation;
  renamedCount: number;
  stringsRewritten: number;
  commentsRewritten: number;
}

export interface CoherentCoverStoryOptions {
  reservedIdentifierNames?: Iterable<string>;
  reservedStringValues?: Iterable<string>;
  existingIdentifiers?: ReadonlyMap<string, string>;
  existingStrings?: ReadonlyMap<string, string>;
}

export async function validateCoherentCoverStoryOutput(output: string, plan: CoverStoryPlan): Promise<CoverStoryValidation> {
  const parser = await getParser(plan.dialect);
  return validateCoverStory(output, plan, parser);
}

interface TextEdit {
  startIndex: number;
  endIndex: number;
  replacement: string;
}

interface NameCandidate {
  original: string;
  kind: 'identifier';
  category: 'function' | 'type' | 'class' | 'property' | 'variable';
  role?: string;
}

const DOMAINS: readonly CoverStoryDomain[] = [
  {
    id: 'parcel-routing',
    title: 'parcel routing',
    noun: 'parcel',
    plural: 'parcels',
    container: 'depot',
    action: 'dispatch',
    statusNoun: 'lane',
    vocabulary: ['parcel', 'parcels', 'depot', 'dispatch', 'lane', 'route', 'weight', 'capacity', 'manifest', 'handoff'],
    functionPrefixes: ['planParcel', 'routeParcel', 'assignParcel', 'scoreParcel'],
    typePrefixes: ['ParcelRequest', 'ParcelDecision', 'ParcelRecord', 'RoutePlan'],
    classNames: ['ParcelQueue', 'DispatchLedger', 'RoutePlanner', 'DepotIndex'],
    numberProperties: ['weightGrams', 'capacityUnits', 'priorityScore', 'delayDays', 'availableUnits', 'reservedUnits', 'limitUnits'],
    booleanProperties: ['isVerified', 'isReady', 'requiresReview', 'hasCapacity', 'isPriority', 'isScheduled'],
    enumProperties: ['lane', 'routeState', 'handlingMode', 'dispatchState', 'handoffType'],
    variables: ['parcelWeight', 'routeCapacity', 'depotBuffer', 'candidateRoute', 'selectedLane', 'resultScore', 'availableUnits', 'reservedUnits', 'handoffDelay', 'capacityLimit'],
    booleanVariables: ['isEligible', 'hasRouteCapacity', 'requiresDispatchReview', 'isWithinLimit', 'shouldHandoff'],
    enumValues: ['standard_lane', 'priority_lane', 'manual_lane', 'hold_lane', 'overflow_lane', 'direct_lane', 'seasonal_lane', 'regional_lane', 'backup_lane', 'express_lane'],
    commentTemplates: [
      'Classify each parcel against the route constraints before selecting a dispatch lane.',
      'Keep the depot buffer intact before releasing the next handoff.',
      'Use the same route state for every branch so the dispatch decision stays coherent.',
    ],
  },
  {
    id: 'recipe-scoring',
    title: 'recipe recommendation scoring',
    noun: 'recipe',
    plural: 'recipes',
    container: 'kitchen',
    action: 'score',
    statusNoun: 'recommendation',
    vocabulary: ['recipe', 'recipes', 'kitchen', 'score', 'recommendation', 'ingredient', 'serving', 'diet', 'menu', 'preference'],
    functionPrefixes: ['scoreRecipe', 'rankRecipe', 'recommendRecipe', 'selectRecipe'],
    typePrefixes: ['RecipeProfile', 'RecipeRecommendation', 'RecipeRecord', 'MenuPlan'],
    classNames: ['RecipeIndex', 'MenuQueue', 'KitchenCatalog', 'PreferenceStore'],
    numberProperties: ['servingCount', 'matchScore', 'ingredientCount', 'prepMinutes', 'availableServings', 'targetScore', 'limitScore'],
    booleanProperties: ['isAvailable', 'isReady', 'requiresReview', 'hasRequiredIngredient', 'isPreferred', 'isScheduled'],
    enumProperties: ['recommendation', 'menuState', 'dietMode', 'selectionState', 'servingType'],
    variables: ['ingredientScore', 'recipeScore', 'kitchenCapacity', 'preferenceWeight', 'candidateRecipe', 'selectedMenu', 'availableServings', 'servingLimit', 'prepDelay', 'matchScore'],
    booleanVariables: ['isEligible', 'hasRequiredIngredient', 'requiresMenuReview', 'isWithinTarget', 'shouldRecommend'],
    enumValues: ['classic_menu', 'preferred_menu', 'manual_menu', 'hold_menu', 'seasonal_menu', 'direct_menu', 'regional_menu', 'backup_menu', 'express_menu', 'limited_menu'],
    commentTemplates: [
      'Score each recipe against the menu constraints before selecting a recommendation.',
      'Keep the kitchen capacity available before adding the next serving.',
      'Use the same recommendation state for every branch so the menu decision stays coherent.',
    ],
  },
  {
    id: 'library-circulation',
    title: 'library circulation',
    noun: 'title',
    plural: 'titles',
    container: 'library',
    action: 'circulate',
    statusNoun: 'shelf',
    vocabulary: ['title', 'titles', 'library', 'circulate', 'shelf', 'catalog', 'loan', 'reader', 'hold'],
    functionPrefixes: ['planTitle', 'routeTitle', 'assignTitle', 'scoreTitle'],
    typePrefixes: ['TitleRequest', 'TitleDecision', 'TitleRecord', 'ShelfPlan'],
    classNames: ['TitleQueue', 'CatalogLedger', 'ShelfPlanner', 'LibraryIndex'],
    numberProperties: ['copyCount', 'loanScore', 'holdCount', 'loanDays', 'availableCopies', 'reservedCopies', 'limitCopies'],
    booleanProperties: ['isAvailable', 'isReady', 'requiresReview', 'hasCopies', 'isPopular', 'isReserved'],
    enumProperties: ['shelf', 'loanState', 'readerMode', 'circulationState', 'returnType'],
    variables: ['titleScore', 'shelfCapacity', 'libraryBuffer', 'candidateTitle', 'selectedShelf', 'resultScore', 'availableCopies', 'reservedCopies', 'returnDelay', 'copyLimit'],
    booleanVariables: ['isEligible', 'hasCopies', 'requiresCirculationReview', 'isWithinLimit', 'shouldHold'],
    enumValues: ['general_shelf', 'priority_shelf', 'manual_shelf', 'hold_shelf', 'overflow_shelf', 'direct_shelf', 'seasonal_shelf', 'regional_shelf', 'backup_shelf', 'express_shelf'],
    commentTemplates: [
      'Score each title against the shelf constraints before selecting a circulation lane.',
      'Keep the library buffer intact before releasing the next loan.',
      'Use the same circulation state for every branch so the catalog decision stays coherent.',
    ],
  },
  {
    id: 'garden-scheduling',
    title: 'garden scheduling',
    noun: 'plot',
    plural: 'plots',
    container: 'garden',
    action: 'schedule',
    statusNoun: 'bed',
    vocabulary: ['plot', 'plots', 'garden', 'schedule', 'bed', 'season', 'seed', 'water', 'growth', 'harvest'],
    functionPrefixes: ['planPlot', 'schedulePlot', 'assignPlot', 'scorePlot'],
    typePrefixes: ['PlotRequest', 'PlotDecision', 'PlotRecord', 'GardenPlan'],
    classNames: ['PlotQueue', 'GardenLedger', 'SeasonPlanner', 'GardenIndex'],
    numberProperties: ['seedCount', 'growthScore', 'waterUnits', 'seasonDays', 'availableBeds', 'reservedBeds', 'limitBeds'],
    booleanProperties: ['isAvailable', 'isReady', 'requiresReview', 'hasWater', 'isPreferred', 'isScheduled'],
    enumProperties: ['bed', 'seasonState', 'growthMode', 'scheduleState', 'harvestType'],
    variables: ['growthScore', 'gardenCapacity', 'seasonBuffer', 'candidatePlot', 'selectedBed', 'resultScore', 'availableBeds', 'reservedBeds', 'harvestDelay', 'bedLimit'],
    booleanVariables: ['isEligible', 'hasWater', 'requiresGardenReview', 'isWithinLimit', 'shouldSchedule'],
    enumValues: ['open_bed', 'priority_bed', 'manual_bed', 'hold_bed', 'seasonal_bed', 'direct_bed', 'regional_bed', 'backup_bed', 'express_bed', 'limited_bed'],
    commentTemplates: [
      'Score each plot against the season constraints before selecting a garden bed.',
      'Keep the garden buffer intact before assigning the next planting window.',
      'Use the same schedule state for every branch so the planting decision stays coherent.',
    ],
  },
  {
    id: 'weather-alerts',
    title: 'weather alert routing',
    noun: 'alert',
    plural: 'alerts',
    container: 'station',
    action: 'route',
    statusNoun: 'channel',
    vocabulary: ['alert', 'alerts', 'station', 'route', 'channel', 'forecast', 'signal', 'threshold', 'region', 'notice'],
    functionPrefixes: ['routeAlert', 'assessAlert', 'assignAlert', 'scoreAlert'],
    typePrefixes: ['AlertRequest', 'AlertDecision', 'AlertRecord', 'ChannelPlan'],
    classNames: ['AlertQueue', 'ForecastLedger', 'ChannelPlanner', 'StationIndex'],
    numberProperties: ['signalScore', 'thresholdValue', 'regionCount', 'noticeMinutes', 'availableChannels', 'reservedChannels', 'limitChannels'],
    booleanProperties: ['isActive', 'isReady', 'requiresReview', 'hasSignal', 'isSevere', 'isScheduled'],
    enumProperties: ['channel', 'alertState', 'forecastMode', 'routingState', 'noticeType'],
    variables: ['signalScore', 'stationCapacity', 'forecastBuffer', 'candidateAlert', 'selectedChannel', 'resultScore', 'availableChannels', 'reservedChannels', 'noticeDelay', 'channelLimit'],
    booleanVariables: ['isEligible', 'hasSignal', 'requiresAlertReview', 'isWithinLimit', 'shouldNotify'],
    enumValues: ['general_channel', 'priority_channel', 'manual_channel', 'hold_channel', 'regional_channel', 'direct_channel', 'seasonal_channel', 'backup_channel', 'express_channel', 'limited_channel'],
    commentTemplates: [
      'Score each alert against the forecast constraints before selecting a notification channel.',
      'Keep the station capacity available before sending the next notice.',
      'Use the same alert state for every branch so the routing decision stays coherent.',
    ],
  },
];

const RESERVED_GLOBALS = new Set([
  'Math', 'Set', 'Map', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Promise', 'JSON', 'console',
  'undefined', 'null', 'true', 'false', 'NaN', 'Infinity', 'Error', 'RegExp', 'Readonly', 'Record', 'Partial',
]);

const DIALECT_ATTEMPT_ORDER: Dialect[] = ['typescript', 'tsx'];

export async function transformCoherentCoverStory(
  source: string,
  options: CoherentCoverStoryOptions = {},
): Promise<CoherentCoverStoryResult> {
  let dialect: Dialect | null = null;
  let parser: Parser | null = null;
  let originalTree: Parser.Tree | null = null;
  for (const attempt of DIALECT_ATTEMPT_ORDER) {
    const candidateParser = await getParser(attempt);
    const candidateTree = candidateParser.parse(source);
    if (!candidateTree.rootNode.hasError) {
      dialect = attempt;
      parser = candidateParser;
      originalTree = candidateTree;
      break;
    }
  }
  if (!dialect || !parser || !originalTree) throw new Error('Cannot build a cover story from a syntax-error tree');

  const shape = inferStructuralShape(originalTree.rootNode);
  const domain = chooseDomain(shape);
  const candidates = collectNameCandidates(originalTree.rootNode);
  const identifierMappings = allocateIdentifierMappings(candidates, domain, source, options);
  const identifierMap = new Map(identifierMappings.map((mapping) => [mapping.original, mapping.synthetic]));
  const reverseIdentifiers = new Map(identifierMappings.map((mapping) => [mapping.synthetic, mapping.original]));

  const commentEdits: TextEdit[] = [];
  const stringEdits: TextEdit[] = [];
  const commentMappings: CoverStoryMapping[] = [];
  const stringMappings: CoverStoryMapping[] = [];
  let commentIndex = 0;
  let stringIndex = 0;
  const fakeStringByOriginal = new Map<string, string>();
  const usedFakeStrings = new Set(options.reservedStringValues ?? []);
  for (const value of options.existingStrings?.values() ?? []) usedFakeStrings.add(value);
  walk(originalTree.rootNode, (node) => {
    if (node.type === 'comment') {
      const fake = renderComment(domain, shape, commentIndex++);
      commentEdits.push({ startIndex: node.startIndex, endIndex: node.endIndex, replacement: fake });
      commentMappings.push({ original: node.text, synthetic: fake, kind: 'comment' });
      return;
    }
    if (node.type === 'string' && !isModuleSource(node) && isLookupPropertyString(node)) {
      const originalValue = node.text.slice(1, -1);
      const fakeValue = options.existingStrings?.get(originalValue) ?? identifierMap.get(originalValue) ?? allocateFakeString(domain, stringIndex++, usedFakeStrings);
      usedFakeStrings.add(fakeValue);
      const quote = node.text[0] ?? '"';
      const fake = `${quote}${fakeValue}${quote}`;
      stringEdits.push({ startIndex: node.startIndex, endIndex: node.endIndex, replacement: fake });
      stringMappings.push({ original: node.text, synthetic: fake, kind: 'string' });
      return;
    }
    if (node.type === 'string' && !isModuleSource(node)) {
      const originalValue = node.text.slice(1, -1);
      const fakeValue = fakeStringByOriginal.get(originalValue) ?? options.existingStrings?.get(originalValue) ?? allocateFakeString(domain, stringIndex++, usedFakeStrings);
      fakeStringByOriginal.set(originalValue, fakeValue);
      usedFakeStrings.add(fakeValue);
      const quote = node.text[0] ?? '"';
      const fake = `${quote}${fakeValue}${quote}`;
      stringEdits.push({ startIndex: node.startIndex, endIndex: node.endIndex, replacement: fake });
      stringMappings.push({ original: node.text, synthetic: fake, kind: 'string' });
    }
  });

  const withCoverText = applyEdits(source, [...commentEdits, ...stringEdits]);
  const rewrittenTree = parser.parse(withCoverText);
  if (rewrittenTree.rootNode.hasError) throw new Error('Cover-story text rewrite produced invalid syntax');

  const identifierEdits: TextEdit[] = [];
  walk(rewrittenTree.rootNode, (node) => {
    if (!isRenameableIdentifierSite(node, identifierMap)) return;
    const synthetic = identifierMap.get(node.text);
    if (!synthetic) return;
    const replacement = node.type === 'shorthand_property_identifier' || node.type === 'shorthand_property_identifier_pattern'
      ? `${synthetic}: ${synthetic}`
      : synthetic;
    identifierEdits.push({ startIndex: node.startIndex, endIndex: node.endIndex, replacement });
  });
  const output = applyEdits(withCoverText, identifierEdits);
  const reverseStrings = new Map<string, string>();
  for (const mapping of stringMappings) reverseStrings.set(mapping.synthetic, mapping.original);
  const reverseComments = new Map<string, string>();
  for (const mapping of commentMappings) reverseComments.set(mapping.synthetic, mapping.original);
  const commentTerms = buildCommentTermMap(domain, candidates);
  const syntheticNames = new Set(identifierMappings.map((mapping) => mapping.synthetic));
  const plan: CoverStoryPlan = {
    generationMode: 'deterministic-template',
    llmRequired: false,
    llmUpgradePoint: 'An LLM can select a better cover domain and write more natural comments after receiving only the structural fingerprint and generated vocabulary.',
    dialect,
    domain,
    shape,
    identifierMappings,
    stringMappings,
    commentMappings,
    reverseIdentifiers,
    reverseStrings,
    reverseComments,
    commentTerms,
    syntheticNames,
  };
  const validation = validateCoverStory(output, plan, parser);
  return {
    output,
    plan,
    validation,
    renamedCount: identifierEdits.length,
    stringsRewritten: stringEdits.length,
    commentsRewritten: commentEdits.length,
  };
}

export function inferStructuralShape(root: Parser.SyntaxNode): StructuralShape {
  const shape: StructuralShape = {
    classes: 0,
    interfaces: 0,
    typeAliases: 0,
    functions: 0,
    methods: 0,
    parameters: 0,
    branches: 0,
    numericLiterals: 0,
    booleanLiterals: 0,
    stringLiterals: 0,
    returnedObjectFields: 0,
    enumLiteralArity: 0,
  };
  const enumValues = new Set<string>();
  walk(root, (node) => {
    if (node.type === 'class_declaration') shape.classes++;
    if (node.type === 'interface_declaration') shape.interfaces++;
    if (node.type === 'type_alias_declaration') shape.typeAliases++;
    if (node.type === 'function_declaration' || node.type === 'arrow_function' || node.type === 'function_expression') shape.functions++;
    if (node.type === 'method_definition') shape.methods++;
    if (node.type === 'required_parameter' || node.type === 'optional_parameter') shape.parameters++;
    if (node.type === 'if_statement' || node.type === 'switch_case' || node.type === 'ternary_expression' || node.type === 'conditional_expression') shape.branches++;
    if (node.type === 'number') shape.numericLiterals++;
    if (node.type === 'true' || node.type === 'false') shape.booleanLiterals++;
    if (node.type === 'string' && !isModuleSource(node)) {
      shape.stringLiterals++;
      if (node.parent?.type === 'literal_type' && node.parent.parent?.type === 'union_type') enumValues.add(node.text);
    }
    if (node.type === 'return_statement') {
      const value = node.childForFieldName('value');
      if (value?.type === 'object') shape.returnedObjectFields = Math.max(shape.returnedObjectFields, value.namedChildren.filter((child) => child.type === 'pair').length);
    }
  });
  shape.enumLiteralArity = enumValues.size;
  return shape;
}

function chooseDomain(shape: StructuralShape): CoverStoryDomain {
  if (shape.classes > 0 || shape.methods > 0) return DOMAINS[2];
  if (shape.enumLiteralArity >= 4 || shape.branches >= 3) return DOMAINS[0];
  if (shape.numericLiterals >= 5 && shape.booleanLiterals > 0) return DOMAINS[3];
  if (shape.stringLiterals > 0) return DOMAINS[1];
  return DOMAINS[4];
}

function collectNameCandidates(root: Parser.SyntaxNode): NameCandidate[] {
  const candidates = new Map<string, NameCandidate>();
  const declaredMemberNames = new Set<string>();
  walk(root, (node) => {
    if (node.type === 'property_signature') {
      const name = node.childForFieldName('name');
      if (name) declaredMemberNames.add(name.text);
    } else if (node.type === 'pair') {
      const key = node.childForFieldName('key');
      if (key) declaredMemberNames.add(key.text);
    } else if (node.type === 'method_definition' || node.type === 'public_field_definition') {
      const name = node.childForFieldName('name');
      if (name) declaredMemberNames.add(name.text);
    }
  });
  const add = (node: Parser.SyntaxNode, category: NameCandidate['category'], role?: string) => {
    const name = node.text;
    if (!name || RESERVED_GLOBALS.has(name) || !/^[A-Za-z_$][\w$]*$/.test(name)) return;
    if (!candidates.has(name)) candidates.set(name, { original: name, kind: 'identifier', category, role });
  };

  walk(root, (node) => {
    if (node.type === 'function_declaration' || node.type === 'generator_function_declaration') {
      const name = node.childForFieldName('name');
      if (name) add(name, 'function');
    } else if (node.type === 'class_declaration') {
      const name = node.childForFieldName('name');
      if (name) add(name, 'class');
    } else if (node.type === 'interface_declaration' || node.type === 'type_alias_declaration') {
      const name = node.childForFieldName('name');
      if (name) add(name, 'type');
    } else if (node.type === 'variable_declarator') {
      const name = node.childForFieldName('name');
      const role = classifyVariableInitializer(node.childForFieldName('value'));
      if (name) collectPatternBindings(name, (binding) => add(binding, 'variable', role));
    } else if (node.type === 'property_signature') {
      const name = node.childForFieldName('name');
      if (name?.type === 'property_identifier') add(name, 'property', classifyProperty(node.childForFieldName('type')));
    } else if (node.type === 'method_definition') {
      const name = node.childForFieldName('name');
      if (name) add(name, 'function');
    } else if (node.type === 'public_field_definition') {
      const name = node.childForFieldName('name');
      if (name) add(name, 'property');
    } else if (node.type === 'pair') {
      const key = node.childForFieldName('key');
      if (key?.type === 'property_identifier' || key?.type === 'identifier') add(key, 'property');
    } else if (node.type === 'member_expression') {
      const property = node.childForFieldName('property');
      const object = node.childForFieldName('object');
      if (
        property?.type === 'property_identifier' &&
        declaredMemberNames.has(property.text) &&
        !(object?.type === 'identifier' && RESERVED_GLOBALS.has(object.text))
      ) add(property, 'property');
    }
  });

  walk(root, (node) => {
    if (node.type !== 'required_parameter' && node.type !== 'optional_parameter') return;
    const pattern = node.childForFieldName('pattern') ?? node.namedChildren.find((child) => child.type === 'identifier');
    if (pattern) collectPatternBindings(pattern, (binding) => add(binding, 'variable'));
  });
  return [...candidates.values()];
}

function classifyVariableInitializer(value: Parser.SyntaxNode | null): NameCandidate['role'] | undefined {
  if (!value) return undefined;
  if (value.type === 'true' || value.type === 'false' || value.type === 'logical_expression') return 'boolean';
  if (value.type === 'unary_expression' && value.children[0]?.text === '!') return 'boolean';
  if (value.type === 'binary_expression') {
    const operator = value.children.find((child) => !child.isNamed)?.text;
    if (operator && ['===', '!==', '==', '!=', '>', '>=', '<', '<=', '&&', '||'].includes(operator)) return 'boolean';
  }
  return undefined;
}

function collectPatternBindings(
  pattern: Parser.SyntaxNode,
  add: (binding: Parser.SyntaxNode) => void,
): void {
  switch (pattern.type) {
    case 'identifier':
    case 'shorthand_property_identifier_pattern':
      add(pattern);
      return;
    case 'object_pattern':
    case 'array_pattern':
      for (const child of pattern.namedChildren) collectPatternBindings(child, add);
      return;
    case 'pair_pattern': {
      const value = pattern.childForFieldName('value');
      if (value) collectPatternBindings(value, add);
      return;
    }
    case 'object_assignment_pattern': {
      const left = pattern.childForFieldName('left');
      if (left) collectPatternBindings(left, add);
      return;
    }
    case 'assignment_pattern': {
      const left = pattern.childForFieldName('left');
      if (left) collectPatternBindings(left, add);
      return;
    }
    case 'rest_pattern': {
      const argument = pattern.namedChild(0);
      if (argument) collectPatternBindings(argument, add);
      return;
    }
    default:
      return;
  }
}

function allocateIdentifierMappings(
  candidates: NameCandidate[],
  domain: CoverStoryDomain,
  source: string,
  options: CoherentCoverStoryOptions,
): CoverStoryMapping[] {
  const forbidden = new Set(source.match(/[A-Za-z_$][\w$]*/g) ?? []);
  const used = new Set(options.reservedIdentifierNames ?? []);
  for (const value of options.existingIdentifiers?.values() ?? []) used.add(value);
  let functionIndex = 0;
  let typeIndex = 0;
  let classIndex = 0;
  let numberIndex = 0;
  let booleanIndex = 0;
  let enumIndex = 0;
  let variableIndex = 0;
  const mappings: CoverStoryMapping[] = [];
  for (const candidate of candidates) {
    const existing = options.existingIdentifiers?.get(candidate.original);
    if (existing) {
      mappings.push({ original: candidate.original, synthetic: existing, kind: 'identifier' });
      continue;
    }
    const list = candidate.category === 'function'
      ? domain.functionPrefixes
      : candidate.category === 'type'
        ? domain.typePrefixes
        : candidate.category === 'class'
          ? domain.classNames
          : candidate.role === 'boolean'
            ? domain.booleanVariables
            : candidate.role === 'enum'
              ? domain.enumProperties
              : candidate.category === 'property' && candidate.role === 'number'
                ? domain.numberProperties
                : candidate.category === 'property' && candidate.role === 'boolean'
                  ? domain.booleanProperties
                  : candidate.category === 'property' && candidate.role === 'enum'
                    ? domain.enumProperties
                    : domain.variables;
    const index = candidate.category === 'function'
      ? functionIndex++
      : candidate.category === 'type'
        ? typeIndex++
        : candidate.category === 'class'
          ? classIndex++
          : candidate.role === 'boolean'
            ? booleanIndex++
            : candidate.role === 'enum'
              ? enumIndex++
              : candidate.category === 'property' && candidate.role === 'number'
                ? numberIndex++
                : variableIndex++;
    let synthetic: string | undefined;
    const namePool = namePoolFor(candidate, list, domain);
    for (let offset = 0; offset < namePool.length; offset++) {
      const candidateName = namePool[(index + offset) % namePool.length];
      if (!used.has(candidateName) && (!forbidden.has(candidateName) || candidateName === candidate.original)) {
        synthetic = candidateName;
        break;
      }
    }
    if (!synthetic) {
      const base = list[index % list.length];
      let suffix = 2;
      synthetic = `${base}${suffix}`;
      while (used.has(synthetic) || forbidden.has(synthetic)) synthetic = `${base}${++suffix}`;
    }
    used.add(synthetic);
    mappings.push({ original: candidate.original, synthetic, kind: 'identifier' });
  }
  return mappings;
}

function namePoolFor(candidate: NameCandidate, primary: readonly string[], domain: CoverStoryDomain): string[] {
  const numericFallbacks = domain.vocabulary.flatMap((word) => [
    `${word}Count`, `${word}Limit`, `${word}Score`, `${word}Delay`,
  ]);
  const booleanFallbacks = domain.vocabulary.flatMap((word) => [
    `is${capitalize(word)}`, `has${capitalize(word)}`, `${word}Ready`,
  ]);
  let fallback: readonly string[];
  if (candidate.category === 'property') {
    fallback = candidate.role === 'number'
      ? [...domain.numberProperties, ...domain.variables, ...numericFallbacks]
      : candidate.role === 'boolean'
        ? [...domain.booleanProperties, ...domain.booleanVariables, ...booleanFallbacks]
        : candidate.role === 'enum'
          ? domain.enumProperties
          : [...domain.variables, ...domain.numberProperties, ...domain.enumProperties, ...numericFallbacks];
  } else if (candidate.category === 'variable') {
    fallback = candidate.role === 'boolean'
      ? [...domain.booleanVariables, ...domain.booleanProperties, ...booleanFallbacks]
      : [...domain.variables, ...domain.numberProperties, ...domain.enumProperties, ...numericFallbacks];
  } else if (candidate.category === 'function') {
    fallback = domain.functionPrefixes;
  } else if (candidate.category === 'type') {
    fallback = domain.typePrefixes;
  } else {
    fallback = domain.classNames;
  }
  return [...new Set([...primary, ...fallback])];
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function buildCommentTermMap(domain: CoverStoryDomain, candidates: NameCandidate[]): Map<string, string> {
  const map = new Map<string, string>();
  const firstType = candidates.find((candidate) => candidate.category === 'type')?.original;
  const firstFunction = candidates.find((candidate) => candidate.category === 'function')?.original;
  const firstProperty = candidates.find((candidate) => candidate.category === 'property')?.original;
  if (firstType) map.set(domain.noun, firstType);
  if (firstFunction) map.set(domain.action, firstFunction);
  if (firstProperty) map.set(domain.statusNoun, firstProperty);
  if (firstType) map.set(domain.container, firstType);
  return map;
}

function classifyProperty(typeNode: Parser.SyntaxNode | null): string {
  if (!typeNode) return 'other';
  const text = typeNode.text;
  if (text.includes('boolean')) return 'boolean';
  if (typeNode.type === 'union_type' || text.includes('|')) return 'enum';
  if (text.includes('number')) return 'number';
  return 'other';
}

function allocateFakeString(domain: CoverStoryDomain, index: number, used: Set<string>): string {
  const values = [...new Set([
    ...domain.enumValues,
    ...domain.vocabulary.map((word) => `${word}_${domain.statusNoun}`),
    ...domain.vocabulary.map((word) => `${domain.statusNoun}_${word}`),
  ])];
  for (let offset = 0; offset < values.length; offset++) {
    const candidate = values[(index + offset) % values.length];
    if (!used.has(candidate)) return candidate;
  }
  const base = values[index % values.length] ?? `${domain.noun}_note`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  return candidate;
}

function renderComment(domain: CoverStoryDomain, shape: StructuralShape, index: number): string {
  const template = domain.commentTemplates[index % domain.commentTemplates.length];
  if (shape.branches === 0 && index === 0) return `// Maintain the ${domain.container} state while ${domain.action}ing ${domain.plural}.`;
  if (template.startsWith('//')) return template;
  return `// ${template}`;
}

function isModuleSource(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  return (parent?.type === 'import_statement' || parent?.type === 'export_statement') && parent.childForFieldName('source')?.id === node.id;
}

function isLookupPropertyString(node: Parser.SyntaxNode): boolean {
  return node.parent?.type === 'literal_type' && node.parent.parent?.type === 'lookup_type';
}

function isRenameableIdentifierSite(node: Parser.SyntaxNode, identifierMap: Map<string, string>): boolean {
  if (!identifierMap.has(node.text)) return false;
  if (
    node.type !== 'identifier' &&
    node.type !== 'type_identifier' &&
    node.type !== 'property_identifier' &&
    node.type !== 'shorthand_property_identifier' &&
    node.type !== 'shorthand_property_identifier_pattern'
  ) return false;
  if (node.type === 'identifier' && node.parent?.type === 'import_specifier') return false;
  return true;
}

function validateCoverStory(output: string, plan: CoverStoryPlan, parser: Parser): CoverStoryValidation {
  const tree = parser.parse(output);
  const parseable = !tree.rootNode.hasError;
  const tokens = new Set(output.match(/[A-Za-z_$][\w$]*/g) ?? []);
  const remainingRealNames = plan.identifierMappings.map((mapping) => mapping.original).filter((name) => tokens.has(name));
  const allDomainTerms = new Set(DOMAINS.flatMap(domainSignature));
  const ownTerms = new Set(domainSignature(plan.domain));
  const foreignVocabulary = [...allDomainTerms].filter((term) => !ownTerms.has(term) && tokens.has(term));
  const missingSyntheticNames = plan.identifierMappings.map((mapping) => mapping.synthetic).filter((name) => !tokens.has(name));
  const shapePreserved = parseable && sameShape(inferStructuralShape(tree.rootNode), plan.shape);
  const valid = parseable && remainingRealNames.length === 0 && foreignVocabulary.length === 0 && shapePreserved;
  return {
    valid,
    parseable,
    remainingRealNames,
    foreignVocabulary,
    missingSyntheticNames,
    shapePreserved,
    reason: valid ? null : describeValidationFailure(parseable, remainingRealNames, foreignVocabulary, shapePreserved),
  };
}

function domainSignature(domain: CoverStoryDomain): string[] {
  return [
    ...domain.vocabulary,
    ...domain.functionPrefixes,
    ...domain.typePrefixes,
    ...domain.classNames,
    ...domain.numberProperties,
    ...domain.booleanProperties,
    ...domain.enumProperties,
    ...domain.variables,
    ...domain.booleanVariables,
    ...domain.enumValues,
  ];
}

function sameShape(left: StructuralShape, right: StructuralShape): boolean {
  return left.classes === right.classes && left.interfaces === right.interfaces && left.typeAliases === right.typeAliases &&
    left.functions === right.functions && left.methods === right.methods && left.parameters === right.parameters &&
    left.branches === right.branches && left.returnedObjectFields === right.returnedObjectFields && left.enumLiteralArity === right.enumLiteralArity;
}

function describeValidationFailure(parseable: boolean, remaining: string[], foreign: string[], shapePreserved: boolean): string {
  if (!parseable) return 'cover story output is not parseable';
  if (remaining.length > 0) return `real identifiers remain: ${remaining.join(', ')}`;
  if (foreign.length > 0) return `foreign cover vocabulary is mixed in: ${foreign.join(', ')}`;
  if (!shapePreserved) return 'AST structural fingerprint changed';
  return 'cover story validation failed';
}

function applyEdits(source: string, edits: TextEdit[]): string {
  let output = source;
  for (const edit of [...edits].sort((left, right) => right.startIndex - left.startIndex)) {
    output = output.slice(0, edit.startIndex) + edit.replacement + output.slice(edit.endIndex);
  }
  return output;
}

function walk(node: Parser.SyntaxNode, visit: (node: Parser.SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}
