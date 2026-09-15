import Foundation
import HealthKit

/// Reading what the phone and the watch already know.
///
/// Why this is worth having next to WHOOP
/// -------------------------------------
/// WHOOP is the only thing that can answer Recovery and Strain, because those
/// are WHOOP's own scores rather than measurements. Apple Health answers a
/// different question: it is where *everything else* ends up. An Apple Watch
/// writes sleep, HRV and resting heart rate there; so does Oura, so does
/// Garmin, so does WHOOP's own app. So one integration here covers every band
/// the person might wear, including the one they switch to next year.
///
/// The two are not redundant and neither is authoritative. The page prefers
/// whichever source actually has a number for a given day, and says which.
///
/// What HealthKit will and will not tell you
/// -----------------------------------------
/// It will not tell you whether the person granted permission to *read*. That
/// is deliberate on Apple's part: if an app could tell the difference between
/// "denied" and "no data", then refusing permission would itself leak that
/// the person has, say, no fertility data. `getRequestStatusForAuthorization`
/// answers only whether asking again would show a prompt.
///
/// So this never claims to know. It reports whether it has been asked, and
/// what it managed to read. An empty week means one of two things and the
/// honest answer names both.
final class FlowHealth {

    private let store = HKHealthStore()

    /// Everything read, in one place, because the request and the reads must
    /// agree — a type read but not requested returns nothing, silently.
    private var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [HKObjectType.workoutType()]
        if let t = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(t) }
        for id in [HKQuantityTypeIdentifier.heartRateVariabilitySDNN,
                   .restingHeartRate,
                   .respiratoryRate,
                   .stepCount,
                   .activeEnergyBurned] {
            if let t = HKObjectType.quantityType(forIdentifier: id) { types.insert(t) }
        }
        return types
    }

    // MARK: - Availability and permission

    static var available: Bool { HKHealthStore.isHealthDataAvailable() }

    /// `asked` is the only thing that can be said truthfully. `.unnecessary`
    /// means a prompt would not appear, which means we have asked before — not
    /// that anything was granted.
    func status(_ done: @escaping ([String: Any]) -> Void) {
        guard FlowHealth.available else {
            done(["available": false, "asked": false]); return
        }
        store.getRequestStatusForAuthorization(toShare: [], read: readTypes) { state, _ in
            DispatchQueue.main.async {
                done(["available": true, "asked": state == .unnecessary])
            }
        }
    }

    func request(_ done: @escaping ([String: Any]) -> Void) {
        guard FlowHealth.available else {
            done(["available": false, "asked": false]); return
        }
        /// Asking to share nothing and read everything. The prompt lists each
        /// type with its own switch, so the person can grant sleep and refuse
        /// heart rate, and we will never find out which they did.
        store.requestAuthorization(toShare: [], read: readTypes) { [weak self] _, _ in
            self?.status(done)
        }
    }

    // MARK: - Reading

    /// One row per day: what the person slept, and how their heart looked.
    /// Days with nothing are omitted rather than sent as a row of nulls.
    func read(days: Int, done: @escaping ([String: Any]) -> Void) {
        guard FlowHealth.available else {
            done(["available": false, "days": []]); return
        }

        let cal = Calendar.current
        let end = Date()
        let start = cal.startOfDay(for: cal.date(byAdding: .day, value: -max(1, min(days, 90)), to: end) ?? end)

        var rows: [String: [String: Any]] = [:]
        let lock = NSLock()
        let group = DispatchGroup()

        func put(_ day: String, _ key: String, _ value: Any) {
            lock.lock(); defer { lock.unlock() }
            var row = rows[day] ?? ["date": day]
            row[key] = value
            rows[day] = row
        }

        let fmt = DateFormatter()
        fmt.calendar = cal
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.timeZone = TimeZone.current
        fmt.dateFormat = "yyyy-MM-dd"

        // ---- sleep -------------------------------------------------------
        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            group.enter()
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
            let q = HKSampleQuery(sampleType: sleepType, predicate: predicate,
                                  limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
                defer { group.leave() }
                guard let samples = samples as? [HKCategorySample] else { return }

                /// Seconds actually asleep, per night. "In bed" is not sleep,
                /// and counting it would tell somebody they slept eight hours
                /// on a night they lay awake for two of them.
                var asleep: [String: TimeInterval] = [:]
                for s in samples {
                    guard let v = HKCategoryValueSleepAnalysis(rawValue: s.value) else { continue }
                    switch v {
                    case .asleepCore, .asleepDeep, .asleepREM, .asleepUnspecified: break
                    default: continue
                    }
                    /// Attributed to the day the night ended, which is the day
                    /// a person means when they say "I slept badly".
                    let day = fmt.string(from: s.endDate)
                    asleep[day, default: 0] += s.endDate.timeIntervalSince(s.startDate)
                }
                for (day, secs) in asleep where secs > 0 {
                    put(day, "hours", (secs / 3600 * 100).rounded() / 100)
                }
            }
            store.execute(q)
        }

        // ---- daily averages ----------------------------------------------
        /// HRV and resting heart rate are both "one number for the day" in
        /// practice, even though the watch samples them repeatedly.
        func daily(_ id: HKQuantityTypeIdentifier, _ unit: HKUnit, _ key: String, _ round: @escaping (Double) -> Any) {
            guard let type = HKObjectType.quantityType(forIdentifier: id) else { return }
            group.enter()
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
            var comps = DateComponents(); comps.day = 1
            let q = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: predicate,
                                                options: .discreteAverage,
                                                anchorDate: cal.startOfDay(for: start),
                                                intervalComponents: comps)
            q.initialResultsHandler = { _, results, _ in
                defer { group.leave() }
                results?.enumerateStatistics(from: start, to: end) { stat, _ in
                    guard let avg = stat.averageQuantity() else { return }
                    put(fmt.string(from: stat.startDate), key, round(avg.doubleValue(for: unit)))
                }
            }
            store.execute(q)
        }

        daily(.heartRateVariabilitySDNN, .secondUnit(with: .milli), "hrv") { Int($0.rounded()) }
        daily(.restingHeartRate, HKUnit.count().unitDivided(by: .minute()), "rhr") { Int($0.rounded()) }
        daily(.respiratoryRate, HKUnit.count().unitDivided(by: .minute()), "resp") { ($0 * 10).rounded() / 10 }

        // ---- sums ---------------------------------------------------------
        func sum(_ id: HKQuantityTypeIdentifier, _ unit: HKUnit, _ key: String) {
            guard let type = HKObjectType.quantityType(forIdentifier: id) else { return }
            group.enter()
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
            var comps = DateComponents(); comps.day = 1
            let q = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: predicate,
                                                options: .cumulativeSum,
                                                anchorDate: cal.startOfDay(for: start),
                                                intervalComponents: comps)
            q.initialResultsHandler = { _, results, _ in
                defer { group.leave() }
                results?.enumerateStatistics(from: start, to: end) { stat, _ in
                    guard let total = stat.sumQuantity() else { return }
                    put(fmt.string(from: stat.startDate), key, Int(total.doubleValue(for: unit).rounded()))
                }
            }
            store.execute(q)
        }

        sum(.stepCount, .count(), "steps")
        sum(.activeEnergyBurned, .kilocalorie(), "kcal")

        // ---- workouts ------------------------------------------------------
        group.enter()
        let wq = HKSampleQuery(sampleType: HKObjectType.workoutType(),
                               predicate: HKQuery.predicateForSamples(withStart: start, end: end, options: []),
                               limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
            defer { group.leave() }
            guard let workouts = samples as? [HKWorkout] else { return }
            var minutes: [String: Double] = [:]
            var counts: [String: Int] = [:]
            for w in workouts {
                let day = fmt.string(from: w.startDate)
                minutes[day, default: 0] += w.duration / 60
                counts[day, default: 0] += 1
            }
            for (day, m) in minutes {
                put(day, "trainMin", Int(m.rounded()))
                put(day, "workouts", counts[day] ?? 0)
            }
        }
        store.execute(wq)

        /// Every query above is asynchronous and independent, so this is the
        /// only place that knows they are all finished. A timeout as well as
        /// the group, because a HealthKit query that never calls back would
        /// otherwise leave the page waiting on a promise forever.
        var answered = false
        let finish = {
            guard !answered else { return }
            answered = true
            lock.lock()
            let out = rows.values
                .sorted { ((($0["date"] as? String) ?? "")) < ((($1["date"] as? String) ?? "")) }
            lock.unlock()
            DispatchQueue.main.async {
                done(["available": true, "days": out, "read": out.count])
            }
        }
        group.notify(queue: .global(), execute: finish)
        DispatchQueue.global().asyncAfter(deadline: .now() + 20, execute: finish)
    }
}
