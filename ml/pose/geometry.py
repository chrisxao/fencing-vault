"""Conservative camera compensation. Metric output requires a tracked piste plane."""
import cv2
import numpy as np


def project(points, matrix):
    return cv2.perspectiveTransform(np.asarray(points, np.float32).reshape(-1, 1, 2), matrix).reshape(-1, 2)


class Camera:
    def __init__(self, width, height, calibration=None):
        self.width, self.height = width, height
        self.previous = None
        self.previous_boxes = []
        self.to_anchor = np.eye(3)
        self.valid = True
        self.metric = None
        self.polygon = None
        if calibration:
            self.polygon = np.float32([[p['x'] * width, p['y'] * height] for p in calibration['points']])
            a, b, w = calibration['leftMeters'], calibration['rightMeters'], calibration['widthMeters']
            target = np.float32([[a, 0], [a, w], [b, w], [b, 0]])
            if abs(cv2.contourArea(self.polygon)) < width * height * .002 or not cv2.isContourConvex(self.polygon.astype(np.int32)):
                raise ValueError('Calibration points must form a non-crossing quadrilateral on the piste.')
            self.metric = cv2.getPerspectiveTransform(self.polygon, target)

    def update(self, image, boxes):
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        movement, inliers, cut = None, 0, False
        if self.previous is not None:
            # Broad image changes alone do not prove a cut: require failed feature matching too.
            difference = np.mean(cv2.absdiff(cv2.resize(gray, (64, 36)), cv2.resize(self.previous, (64, 36))))
            mask = np.zeros_like(gray)
            if self.polygon is not None and self.valid:
                polygon = project(self.polygon, np.linalg.inv(self.to_anchor))
                cv2.fillConvexPoly(mask, polygon.astype(np.int32), 255)
            else:
                mask[int(self.height * .12):int(self.height * .88)] = 255
            for x1, y1, x2, y2 in self.previous_boxes:
                cv2.rectangle(mask, (max(0, int(x1)-20), max(0, int(y1)-20)), (int(x2)+20, int(y2)+20), 0, -1)
            points = cv2.goodFeaturesToTrack(self.previous, 500, .015, 12, mask=mask)
            if points is not None and len(points) >= 12:
                nxt, ok, _ = cv2.calcOpticalFlowPyrLK(self.previous, gray, points, None)
                back, bok, _ = cv2.calcOpticalFlowPyrLK(gray, self.previous, nxt, None)
                good = (ok.ravel() == 1) & (bok.ravel() == 1) & (np.linalg.norm(points-back, axis=2).ravel() < 1.5)
                # Moving athletes must also be masked in the new frame.
                for x1, y1, x2, y2 in boxes:
                    q = nxt.reshape(-1, 2)
                    good &= ~((q[:, 0] > x1-20) & (q[:, 0] < x2+20) & (q[:, 1] > y1-20) & (q[:, 1] < y2+20))
                if good.sum() >= 12:
                    h, support = cv2.findHomography(points[good], nxt[good], cv2.RANSAC, 2.5)
                    if h is not None and support is not None:
                        inliers = int(support.sum())
                        corners = np.float32([[0, 0], [self.width, 0], [self.width, self.height], [0, self.height]])
                        moved = project(corners, h)
                        area_ratio = abs(cv2.contourArea(moved)) / (self.width*self.height)
                        spread = np.ptp(points[good][support.ravel() == 1].reshape(-1, 2), axis=0)
                        if inliers >= 12 and inliers / good.sum() >= .65 and .65 < area_ratio < 1.5 and spread[0] > self.width*.15 and np.isfinite(moved).all():
                            movement = h
            if movement is not None and self.valid:
                self.to_anchor = self.to_anchor @ np.linalg.inv(movement)
                self.to_anchor /= self.to_anchor[2, 2]
            else:
                self.valid = False  # Do not silently resume a broken metric chain.
                cut = difference > 28
        self.previous, self.previous_boxes = gray, boxes
        status = 'anchored' if self.valid and self.metric is not None else 'relative' if movement is not None else 'unknown'
        return {'status': status, 'inliers': inliers, 'transform': movement.reshape(-1).round(7).tolist() if movement is not None else None}, cut, movement

    def meters(self, point):
        if not self.valid or self.metric is None:
            return None
        value = project([point], self.metric @ self.to_anchor)[0]
        # Reject off-plane, out-of-strip estimates instead of clipping them to a plausible value.
        if not np.isfinite(value).all() or not -.5 <= value[0] <= 14.5 or not -.3 <= value[1] <= 2.3:
            return None
        return float(value[0])
