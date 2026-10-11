import { fakesDeclareContract } from './fakes-declare-contract.mjs'
import { fakesResidency } from './fakes-residency.mjs'
import { layerImports } from './layer-imports.mjs'
import { noImpureConstants } from './no-impure-constants.mjs'
import { noTypeExports } from './no-type-exports.mjs'
import { testsTreeLayout } from './tests-tree-layout.mjs'

export default {
    meta: { name: 'boundaries' },
    rules: {
        'no-impure-constants': noImpureConstants,
        'no-type-exports': noTypeExports,
        'fakes-declare-contract': fakesDeclareContract,
        'fakes-residency': fakesResidency,
        'tests-tree-layout': testsTreeLayout,
        'layer-imports': layerImports,
    },
}
