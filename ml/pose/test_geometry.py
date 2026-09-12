import unittest
import cv2
import numpy as np
from geometry import Camera, project


class CameraTests(unittest.TestCase):
    def texture(self):
        rng = np.random.default_rng(22)
        return rng.integers(0, 255, (480, 800, 3), dtype=np.uint8)

    def test_camera_pan_does_not_look_like_fencer_motion(self):
        image = self.texture()
        cal = {'points': [{'x':0,'y':1},{'x':0,'y':0},{'x':1,'y':0},{'x':1,'y':1}], 'leftMeters':0,'rightMeters':14,'widthMeters':1.5}
        camera = Camera(800, 480, cal)
        camera.update(image, [])
        before = camera.meters([400, 300])
        moved = cv2.warpAffine(image, np.float32([[1,0,14],[0,1,2]]), (800,480))
        status, cut, matrix = camera.update(moved, [])
        self.assertEqual(status['status'], 'anchored')
        self.assertFalse(cut)
        self.assertIsNotNone(matrix)
        self.assertAlmostEqual(camera.meters([414,302]), before, delta=.02)
        self.assertAlmostEqual(camera.meters([454,302])-before, .7, delta=.03)

    def test_missing_background_invalidates_metric_chain(self):
        cal = {'points':[{'x':0,'y':1},{'x':0,'y':0},{'x':1,'y':0},{'x':1,'y':1}], 'leftMeters':0,'rightMeters':14,'widthMeters':1.5}
        camera = Camera(800,480,cal)
        camera.update(self.texture(), [])
        camera.update(np.zeros((480,800,3),np.uint8), [])
        self.assertIsNone(camera.meters([400,300]))
        camera.update(self.texture(), [])
        self.assertIsNone(camera.meters([400,300]))

    def test_degenerate_calibration_rejected(self):
        with self.assertRaises(ValueError):
            Camera(800,480,{'points':[{'x':.5,'y':.5}]*4,'leftMeters':0,'rightMeters':14,'widthMeters':1.5})

if __name__ == '__main__':
    unittest.main()
