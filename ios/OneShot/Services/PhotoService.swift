import Foundation
import Photos
import UIKit

class PhotoService {
    static let shared = PhotoService()

    private let lastSyncKey = "com.oneshot.lastScreenshotSync"

    private init() {}

    // MARK: - Permission

    var authorizationStatus: PHAuthorizationStatus {
        PHPhotoLibrary.authorizationStatus(for: .readWrite)
    }

    func requestAccess() async -> Bool {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        return status == .authorized || status == .limited
    }

    // MARK: - Fetch Screenshots

    /// Max screenshots to process per scan (avoids processing 10k+ on first run)
    static let maxPerScan = 50

    /// Fetches screenshot assets added since the last sync (capped to `maxPerScan`).
    /// Returns an array of (PHAsset, UIImage) pairs.
    func fetchNewScreenshots() async throws -> [(asset: PHAsset, image: UIImage)] {
        let status = authorizationStatus
        guard status == .authorized || status == .limited else {
            throw PhotoError.notAuthorized
        }

        // On first run, only go back 7 days instead of scanning everything
        let fallbackDate = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date.distantPast
        let lastSync = UserDefaults.standard.object(forKey: lastSyncKey) as? Date
            ?? fallbackDate

        let fetchOptions = PHFetchOptions()
        fetchOptions.predicate = NSPredicate(
            format: "(mediaSubtype & %d) != 0 AND creationDate > %@",
            PHAssetMediaSubtype.photoScreenshot.rawValue,
            lastSync as NSDate
        )
        fetchOptions.sortDescriptors = [
            NSSortDescriptor(key: "creationDate", ascending: true)
        ]

        let assets = PHAsset.fetchAssets(with: .image, options: fetchOptions)
        let count = min(assets.count, Self.maxPerScan)

        var results: [(PHAsset, UIImage)] = []
        let imageManager = PHImageManager.default()
        let options = PHImageRequestOptions()
        options.isSynchronous = false
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        // Request a reasonable size for vision analysis (not full 3x retina)
        let targetSize = CGSize(width: 1024, height: 1024)

        for i in 0..<count {
            let asset = assets.object(at: i)
            let image = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UIImage, Error>) in
                imageManager.requestImage(
                    for: asset,
                    targetSize: targetSize,
                    contentMode: .aspectFit,
                    options: options
                ) { image, info in
                    if let image = image {
                        continuation.resume(returning: image)
                    } else {
                        continuation.resume(throwing: PhotoError.failedToLoadImage)
                    }
                }
            }
            results.append((asset, image))
        }

        return results
    }

    /// Mark the sync checkpoint so we don't re-process these screenshots next time.
    func advanceSyncCheckpoint() {
        UserDefaults.standard.set(Date(), forKey: lastSyncKey)
    }

    /// Reset sync so all screenshots are re-processed on next scan.
    func resetSync() {
        UserDefaults.standard.removeObject(forKey: lastSyncKey)
    }

    /// Generate a stable hash for a screenshot asset.
    func hashForAsset(_ asset: PHAsset) -> String {
        // Use the local identifier as a stable, unique key
        return asset.localIdentifier
    }
}

enum PhotoError: LocalizedError {
    case notAuthorized
    case failedToLoadImage

    var errorDescription: String? {
        switch self {
        case .notAuthorized:
            return "Photo library access not granted. Please enable in Settings."
        case .failedToLoadImage:
            return "Failed to load screenshot image."
        }
    }
}
