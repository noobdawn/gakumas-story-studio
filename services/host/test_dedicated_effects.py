import copy
import unittest
from dedicated_effects import validate_message


class DedicatedEffectsTests(unittest.TestCase):
    def setUp(self):
        self.layer = dict(effectVersion=2, effectType='thought', weight=1, strength=1, seed=1,
                          parameters=dict(radius=.35, softness=.55, darkness=.65))

    def packet(self, layer):
        return {'composition': {'time': 2, 'nodes': [{'effects': [layer]}]}}

    def test_thought_all_composition_paths_and_categories(self):
        validate_message(self.packet(self.layer))
        for field in ['leftEffects', 'rightEffects']:
            validate_message({'composition': {'time': 2, 'nodes': [{field: [self.layer]}]}})
        validate_message({'postEffects': {'time': 2, 'targets': [{'target': 'media', 'layers': [self.layer]}]}})

    def test_old_player_rejected_explicitly(self):
        with self.assertRaisesRegex(ValueError, '心理活动'):
            validate_message(self.packet(self.layer), thought_capable=False)

    def test_invalid_thought_parameters_and_clock(self):
        for key, value in [('radius', 1.1), ('softness', 0), ('darkness', -1), ('radius', float('nan'))]:
            layer = copy.deepcopy(self.layer)
            layer['parameters'][key] = value
            with self.assertRaises(ValueError):
                validate_message(self.packet(layer))
        for parameters in [dict(radius=.35, softness=.55), dict(self.layer['parameters'], tone=1)]:
            with self.assertRaises(ValueError):
                validate_message(self.packet(dict(self.layer, parameters=parameters)))
        message = self.packet(self.layer)
        message['postEffects'] = {'time': 3}
        with self.assertRaises(ValueError):
            validate_message(message)
